import { createHash } from 'node:crypto';
import type { PrismaClient } from '@accordo/db';
import {
  InvalidShippingSignatureError,
  MOCK_SIGNATURE_HEADER,
  mockWebhookBody,
  type ShipmentStatusCode,
  type ShippingProvider,
  signMockWebhook,
  type TrackingProvider,
} from '@accordo/shipping';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, S3, SHIPPING, TRACKING } from '../platform/infra.providers.js';

const NEXT: Partial<Record<string, ShipmentStatusCode>> = {
  PENDING: 'IN_TRANSIT',
  LABEL_CREATED: 'IN_TRANSIT',
  IN_TRANSIT: 'OUT_FOR_DELIVERY',
  OUT_FOR_DELIVERY: 'DELIVERED',
  AVAILABLE_FOR_PICKUP: 'DELIVERED',
};

/** Carrier/tracking webhooks (SPEC §7.3) and labels from the private bucket. */
@Injectable()
export class ShippingWebhooksService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SHIPPING) private readonly shipping: ShippingProvider,
    @Inject(TRACKING) private readonly tracking: TrackingProvider,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * HMAC-verified updates stored once (body hash as event id) and queued to the worker through
   * the outbox in the same transaction, like the payment webhooks.
   */
  async receive(
    kind: 'shipping' | 'tracking',
    providerName: string,
    headers: Record<string, string | undefined>,
    raw: Buffer,
  ): Promise<{ duplicate: boolean }> {
    const provider = kind === 'shipping' ? this.shipping : this.tracking;
    if (providerName !== provider.name) throw new NotFoundException();
    let updates: ReturnType<ShippingProvider['parseWebhook']>;
    try {
      updates = provider.parseWebhook(headers, raw);
    } catch (e) {
      if (e instanceof InvalidShippingSignatureError || e instanceof SyntaxError)
        throw new BadRequestException({ code: 'INVALID_SIGNATURE' });
      throw e;
    }
    const source = `${kind}:${provider.name}`;
    const eventId = createHash('sha256').update(raw).digest('hex');
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.webhookEvent.createMany({
        data: {
          provider: source,
          eventId,
          type: 'tracking.updates',
          payload: {
            updates: updates.map((u) => ({ ...u, occurredAt: u.occurredAt.toISOString() })),
          },
        },
        skipDuplicates: true,
      });
      if (count)
        await tx.outboxEvent.create({
          data: {
            aggregateType: 'WebhookEvent',
            aggregateId: eventId,
            type: 'shipping.updates',
            payload: { provider: source, eventId },
          },
        });
      return { duplicate: count === 0 };
    });
  }

  /** Development only: the next tracking event of a mock shipment, through the real webhook. */
  async advance(shipmentId: string, userId: string) {
    const s = await this.db.shipment.findFirst({
      where: { id: shipmentId, order: { OR: [{ buyerId: userId }, { sellerId: userId }] } },
    });
    if (!s?.providerShipmentId) throw new NotFoundException();
    const kind = s.providerShipmentId.startsWith('track_') ? 'tracking' : 'shipping';
    if ((kind === 'shipping' ? this.shipping : this.tracking).name !== 'mock')
      throw new BadRequestException({ code: 'MOCK_PROVIDER_ONLY' });
    const status = NEXT[s.status];
    if (!status) throw new ConflictException({ code: 'SHIPMENT_FINAL' });
    const body = mockWebhookBody([
      { shipmentId: s.providerShipmentId, status, occurredAt: new Date() },
    ]);
    const signature = signMockWebhook(
      body,
      this.env.SHIPPING_WEBHOOK_SECRET || 'mock-shipping-secret',
    );
    await this.receive(kind, 'mock', { [MOCK_SIGNATURE_HEADER]: signature }, Buffer.from(body));
    return { status };
  }

  async labelPdf(key: string): Promise<Buffer> {
    const object = await this.s3.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: key }),
    );
    return Buffer.from(
      await (object.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(),
    );
  }
}
