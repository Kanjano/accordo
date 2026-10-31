import type { PrismaClient } from '@accordo/db';
import { sellerChargeEntries } from '@accordo/domain';
import { writeLedger } from '@accordo/orders';
import type {
  ParcelSizeCode,
  PostalAddress,
  ShippingProvider,
  TrackingProvider,
} from '@accordo/shipping';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../env.js';
import { PRISMA, S3, SHIPPING, TRACKING } from '../infra.js';

const SELLER_FAULT = ['SELLER_CANCELLED', 'SHIP_DEADLINE_EXPIRED'];

/** Shipping side of the order effects (SPEC §7.3). Every step is idempotent. */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SHIPPING) private readonly shipping: ShippingProvider,
    @Inject(TRACKING) private readonly tracking: TrackingProvider,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async address(userId: string, type: 'SENDER' | 'SHIPPING'): Promise<PostalAddress> {
    const a = await this.db.address.findFirstOrThrow({
      where: { userId, type },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: { comune: { include: { provincia: true } }, user: { select: { email: true } } },
    });
    return {
      name: a.fullName,
      line1: a.line1,
      line2: a.line2,
      cap: a.cap,
      city: a.comune.name,
      provincia: a.comune.provincia.sigla,
      country: 'IT',
      phone: a.phone,
      email: a.user.email,
    };
  }

  private async weight(size: ParcelSizeCode): Promise<number> {
    const row = await this.db.platformSetting.findUnique({ where: { key: 'parcelSizes' } });
    return (row?.value as Record<string, { maxKg: number }> | undefined)?.[size]?.maxKg ?? 5;
  }

  private async storeLabel(orderId: string, shipmentId: string, pdf: Buffer) {
    const key = `labels/${orderId}/${shipmentId}.pdf`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.env.S3_BUCKET_PRIVATE,
        Key: key,
        Body: pdf,
        ContentType: 'application/pdf',
      }),
    );
    return key;
  }

  /** Paid order with integrated shipping: label from the provider, stored in the private bucket. */
  async createLabel(orderId: string): Promise<boolean> {
    const existing = await this.db.shipment.findFirst({
      where: { orderId, direction: 'OUTBOUND', labelKey: { not: null } },
    });
    if (existing) return false;
    const o = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { listing: { select: { parcelSize: true } }, buyer: { select: { email: true } } },
    });
    const size = (o.listing.parcelSize ?? 'M') as ParcelSizeCode;
    const recipientAddr = o.shippingAddress as Record<string, string | null>;
    const recipient: PostalAddress = {
      name: recipientAddr.fullName as string,
      line1: recipientAddr.line1 as string,
      line2: recipientAddr.line2,
      cap: recipientAddr.cap as string,
      city: recipientAddr.comune as string,
      provincia: recipientAddr.provincia as string,
      country: 'IT',
      phone: recipientAddr.phone as string,
      email: o.buyer.email,
    };
    const label = await this.shipping.createShipment({
      reference: o.number,
      sender: await this.address(o.sellerId, 'SENDER'),
      recipient,
      servicePointId: (o.servicePoint as { id?: string } | null)?.id ?? null,
      parcelSize: size,
      weightKg: await this.weight(size),
    });
    const shipment = await this.db.shipment.create({
      data: {
        orderId,
        provider: this.shipping.name,
        providerShipmentId: label.providerShipmentId,
        carrier: label.carrier,
        service: label.service,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        parcelSize: size,
        status: 'LABEL_CREATED',
        estimatedDeliveryAt: label.estimatedDeliveryAt,
      },
    });
    const labelKey = await this.storeLabel(orderId, shipment.id, label.labelPdf);
    await this.db.shipment.update({ where: { id: shipment.id }, data: { labelKey } });
    return true;
  }

  /** SPEC §6.7, configurable by admins (`refundPolicy`). */
  private async policy() {
    const row = await this.db.platformSetting.findUnique({ where: { key: 'refundPolicy' } });
    return {
      chargeLabelOnSellerCancel: true,
      chargeLabelOnMutualCancel: false,
      chargeReturnLabelWhenSellerAtFault: true,
      ...(row?.value as object | undefined),
    } as {
      chargeLabelOnSellerCancel: boolean;
      chargeLabelOnMutualCancel: boolean;
      chargeReturnLabelWhenSellerAtFault: boolean;
    };
  }

  /** Return label (dispute with return, SPEC §6.6): the buyer ships back to the seller. */
  async createReturnLabel(orderId: string): Promise<boolean> {
    if (await this.db.shipment.findFirst({ where: { orderId, direction: 'RETURN' } })) return false;
    const o = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { listing: { select: { parcelSize: true } } },
    });
    const size = (o.listing.parcelSize ?? 'M') as ParcelSizeCode;
    const label = await this.shipping.createReturn({
      reference: o.number,
      sender: await this.address(o.buyerId, 'SHIPPING'),
      recipient: await this.address(o.sellerId, 'SENDER'),
      parcelSize: size,
      weightKg: await this.weight(size),
    });
    const shipment = await this.db.shipment.create({
      data: {
        orderId,
        direction: 'RETURN',
        provider: this.shipping.name,
        providerShipmentId: label.providerShipmentId,
        carrier: label.carrier,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        parcelSize: size,
        status: 'LABEL_CREATED',
      },
    });
    await this.db.shipment.update({
      where: { id: shipment.id },
      data: { labelKey: await this.storeLabel(orderId, shipment.id, label.labelPdf) },
    });
    // The return is on the seller when the problem is theirs (SPEC §6.7).
    const dispute = await this.db.dispute.findUnique({ where: { orderId } });
    if (dispute?.sellerAtFault && (await this.policy()).chargeReturnLabelWhenSellerAtFault) {
      const sizes = await this.db.platformSetting.findUnique({ where: { key: 'parcelSizes' } });
      const price =
        (sizes?.value as Record<string, { priceCents: number }> | undefined)?.[size]?.priceCents ??
        0;
      if (price)
        await this.db.$transaction((tx) =>
          writeLedger(
            tx,
            orderId,
            sellerChargeEntries(price, o.sellerId, 'SHIPPING_PAYABLE'),
            `return-label:${orderId}`,
          ),
        );
    }
    return true;
  }

  async registerTracking(orderId: string) {
    const s = await this.db.shipment.findFirst({
      where: { orderId, direction: 'OUTBOUND', providerShipmentId: { startsWith: 'track_' } },
    });
    if (s?.carrier && s.trackingNumber && s.providerShipmentId)
      await this.tracking.register({
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
        shipmentId: s.providerShipmentId,
      });
  }

  /**
   * SPEC §6.7: a cancelled order's unused label is cancelled; if the carrier refuses and the
   * seller is at fault, its cost is charged to the seller (`SELLER_RECEIVABLE`).
   */
  async cancelLabel(orderId: string) {
    const s = await this.db.shipment.findFirst({
      where: {
        orderId,
        direction: 'OUTBOUND',
        status: 'LABEL_CREATED',
        provider: this.shipping.name,
      },
    });
    if (!s?.providerShipmentId) return;
    const cancelled = await this.shipping.cancelShipment(s.providerShipmentId);
    if (cancelled) {
      await this.db.shipment.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
      return;
    }
    const o = await this.db.order.findUniqueOrThrow({ where: { id: orderId } });
    const last = await this.db.orderEvent.findFirst({
      where: { orderId, toStatus: 'CANCELLED' },
      orderBy: { createdAt: 'desc' },
    });
    const policy = await this.policy();
    const charge = last
      ? SELLER_FAULT.includes(last.event)
        ? policy.chargeLabelOnSellerCancel
        : last.event === 'MUTUAL_CANCEL' && policy.chargeLabelOnMutualCancel
      : false;
    if (charge && o.shippingPriceCents > 0) {
      await this.db.$transaction((tx) =>
        writeLedger(
          tx,
          orderId,
          sellerChargeEntries(o.shippingPriceCents, o.sellerId, 'SHIPPING_PAYABLE'),
          `label-charge:${orderId}`,
        ),
      );
      this.logger.warn(`Label of order ${o.number} not cancellable: charged to the seller`);
    } else {
      this.logger.warn(`Label of order ${o.number} not cancellable: borne by the platform`);
    }
  }
}
