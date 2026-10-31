import type { PrismaClient } from '@accordo/db';
import {
  chargebackLossEntries,
  chargebackSellerLiableEntries,
  refundAfterTransferEntries,
  transferReversalEntries,
} from '@accordo/domain';
import { writeLedger } from '@accordo/orders';
import type { PaymentEvent, PaymentProvider } from '@accordo/payments';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PAYMENTS, PRISMA } from '../infra.js';

type Opened = Extract<PaymentEvent, { kind: 'dispute.created' }>;
type Closed = Extract<PaymentEvent, { kind: 'dispute.closed' }>;

/** Σ SELLER_RECEIVABLE debits − credits: what the seller owes the platform. */
export async function sellerReceivable(db: PrismaClient, sellerId: string): Promise<number> {
  const rows = await db.ledgerEntry.groupBy({
    by: ['direction'],
    where: { account: 'SELLER_RECEIVABLE', userId: sellerId },
    _sum: { amountCents: true },
  });
  const sum = (d: string) => rows.find((r) => r.direction === d)?._sum.amountCents ?? 0;
  return sum('DEBIT') - sum('CREDIT');
}

/** SPEC §6.8: chargebacks (bank disputes) with automatic evidence and seller protection. */
@Injectable()
export class ChargebackService {
  private readonly logger = new Logger(ChargebackService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(PAYMENTS) private readonly provider: PaymentProvider,
  ) {}

  /**
   * The seller followed the rules (tracked shipment delivered, or hand-delivery code verified):
   * a lost chargeback is the platform's loss, not the seller's.
   */
  async sellerProtected(orderId: string): Promise<boolean> {
    const [delivered, handover] = await Promise.all([
      this.db.shipment.count({
        where: {
          orderId,
          direction: 'OUTBOUND',
          status: 'DELIVERED',
          trackingNumber: { not: null },
        },
      }),
      this.db.orderEvent.count({ where: { orderId, event: 'HANDOVER_CODE_VERIFIED' } }),
    ]);
    return delivered + handover > 0;
  }

  async opened(e: Opened) {
    const order = await this.db.order.findFirst({
      where: { chargeId: e.chargeId },
      include: { buyer: { select: { name: true, email: true } } },
    });
    if (!order) return;
    await this.db.paymentDispute.upsert({
      where: { providerDisputeId: e.disputeId },
      create: {
        orderId: order.id,
        providerDisputeId: e.disputeId,
        amountCents: e.amountCents,
        reason: e.reason,
        status: 'needs_response',
        evidenceDueBy: e.evidenceDueBy,
      },
      update: {},
    });
    // Hold the transfer if it has not left yet.
    await this.db.order.updateMany({
      where: { id: order.id, payoutStatus: { in: ['NOT_DUE', 'SCHEDULED'] } },
      data: { payoutStatus: 'ON_HOLD' },
    });

    const [shipment, events, conversation] = await Promise.all([
      this.db.shipment.findFirst({ where: { orderId: order.id, direction: 'OUTBOUND' } }),
      this.db.orderEvent.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } }),
      this.db.conversation.findUnique({
        where: { listingId_buyerId: { listingId: order.listingId, buyerId: order.buyerId } },
        include: { messages: { orderBy: { createdAt: 'asc' }, take: 30 } },
      }),
    ]);
    const lines = [
      `Ordine ${order.number}, pagato il ${order.paidAt?.toISOString() ?? '?'}.`,
      ...events.map(
        (ev) => `${ev.createdAt.toISOString()} ${ev.event} → ${ev.toStatus} (${ev.actorRole})`,
      ),
      ...(shipment
        ? [
            `Spedizione ${shipment.carrier ?? ''} ${shipment.trackingNumber ?? ''}: ${shipment.status}`,
            ...((shipment.events as Array<{ status: string; occurredAt: string }>) ?? []).map(
              (x) => `  ${x.occurredAt} ${x.status}`,
            ),
          ]
        : []),
      ...(conversation?.messages.length
        ? [
            'Chat:',
            ...conversation.messages.map(
              (m) =>
                `  ${m.createdAt.toISOString()} ${m.senderId === order.buyerId ? 'acquirente' : m.senderId ? 'venditore' : 'sistema'}: ${(m.body ?? '').slice(0, 200)}`,
            ),
          ]
        : []),
    ];
    await this.provider.submitDisputeEvidence(e.disputeId, {
      productDescription: (order.listingSnapshot as { title?: string }).title ?? order.number,
      customerName: order.buyer.name,
      customerEmail: order.buyer.email,
      shippingCarrier: shipment?.carrier ?? undefined,
      shippingTrackingNumber: shipment?.trackingNumber ?? undefined,
      shippingDate: shipment?.shippedAt?.toISOString().slice(0, 10),
      uncategorizedText: lines.join('\n').slice(0, 20_000),
    });
    await this.db.paymentDispute.update({
      where: { providerDisputeId: e.disputeId },
      data: { status: 'under_review' },
    });
    await this.notify(order.id, 'chargeback.opened', ['SELLER', 'SUPPORT']);
  }

  async closed(e: Closed, transfer: (orderId: string, amountCents: number) => Promise<void>) {
    const dispute = await this.db.paymentDispute.findUnique({
      where: { providerDisputeId: e.disputeId },
      include: { order: true },
    });
    if (!dispute || dispute.status === 'won' || dispute.status === 'lost') return;
    const o = dispute.order;
    await this.db.paymentDispute.update({ where: { id: dispute.id }, data: { status: e.status } });
    const ref = `chargeback:${e.disputeId}`;
    const release = async () => {
      if (o.status === 'COMPLETED' && !o.transferredAt)
        await transfer(o.id, o.sellerNetCents - o.refundedCents);
    };

    if (e.status === 'won') {
      await release();
      await this.notify(o.id, 'chargeback.won', ['SELLER']);
      return;
    }
    if (await this.sellerProtected(o.id)) {
      // Seller protection: the platform bears the loss and the seller is paid as usual.
      await this.db.$transaction((tx) =>
        writeLedger(tx, o.id, chargebackLossEntries(e.amountCents), ref),
      );
      await release();
      await this.notify(o.id, 'chargeback.lost_protected', ['SELLER']);
      return;
    }
    if (!o.transferredAt) {
      const payable = o.sellerNetCents - o.refundedCents;
      await this.db.$transaction(async (tx) => {
        await writeLedger(
          tx,
          o.id,
          chargebackSellerLiableEntries(e.amountCents, payable, o.sellerId),
          ref,
        );
        await tx.order.update({ where: { id: o.id }, data: { payoutStatus: 'REVERSED' } });
      });
    } else {
      // Already paid out: the seller owes it back; the rest is the platform's loss.
      const fromSeller = Math.min(e.amountCents, o.sellerNetCents);
      await this.db.$transaction(async (tx) => {
        await writeLedger(tx, o.id, refundAfterTransferEntries(fromSeller, o.sellerId), ref);
        if (e.amountCents > fromSeller)
          await writeLedger(
            tx,
            o.id,
            chargebackLossEntries(e.amountCents - fromSeller),
            `${ref}:platform`,
          );
      });
      if (o.transferId)
        try {
          await this.provider.reverseTransfer(o.transferId, fromSeller, `reversal:${ref}`);
          await this.db.$transaction((tx) =>
            writeLedger(
              tx,
              o.id,
              transferReversalEntries(fromSeller, o.sellerId),
              `reversal:${ref}`,
            ),
          );
        } catch (err) {
          this.logger.warn(`Reversal for ${ref} failed, seller credit kept: ${String(err)}`);
        }
    }
    await this.notify(o.id, 'chargeback.lost_seller', ['SELLER', 'SUPPORT']);
  }

  private notify(orderId: string, template: string, to: string[]) {
    return this.db.outboxEvent.create({
      data: {
        aggregateType: 'Order',
        aggregateId: orderId,
        type: 'order.effects',
        payload: {
          orderId,
          eventId: `${template}:${Date.now()}`,
          effects: [{ type: 'NOTIFY', template, to }],
        },
      },
    });
  }
}
