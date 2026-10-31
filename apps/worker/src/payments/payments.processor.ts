import type { PrismaClient } from '@accordo/db';
import {
  fullRefundBeforeTransferEntries,
  type OrderEffect,
  partialRefundEntries,
  processorFeeEntries,
  transferToSellerEntries,
} from '@accordo/domain';
import { applyOrderEvent, paymentInputOf, writeLedger } from '@accordo/orders';
import type { PaymentEvent, PaymentProvider } from '@accordo/payments';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { ENV, type Env } from '../env.js';
import { PAYMENTS, PRISMA } from '../infra.js';
import { QUEUES } from '../queues.js';
import { ORDER_TEMPLATES } from './order-templates.js';

interface EffectsJob {
  orderId: string;
  eventId?: string;
  effects: OrderEffect[];
}

/**
 * `payments` queue (SPEC §5.7): provider webhooks and the external effects of order transitions.
 * Every step is idempotent (provider idempotency keys, unique ledger references), so BullMQ retries
 * after a partial failure are safe.
 */
@Processor(QUEUES.payments, { concurrency: 4 })
export class PaymentsProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentsProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(PAYMENTS) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
    @InjectQueue(QUEUES.notifications) private readonly notifications: Queue,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'webhook.received')
      return this.webhook(job.data as { provider: string; eventId: string }, job.attemptsMade);
    if (job.name === 'order.effects') return this.effects(job.data as EffectsJob);
  }

  // ───────────── Webhooks ─────────────

  private async webhook(key: { provider: string; eventId: string }, attempt: number) {
    const row = await this.db.webhookEvent.findUnique({
      where: { provider_eventId: { provider: key.provider, eventId: key.eventId } },
    });
    if (!row || row.processedAt) return; // processed once (SPEC §6.12)
    try {
      await this.handle((row.payload as { event: PaymentEvent }).event);
      await this.db.webhookEvent.update({
        where: { provider_eventId: { provider: key.provider, eventId: key.eventId } },
        data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null },
      });
    } catch (e) {
      await this.db.webhookEvent.update({
        where: { provider_eventId: { provider: key.provider, eventId: key.eventId } },
        data: { attempts: { increment: 1 }, lastError: String(e).slice(0, 1000) },
      });
      if (attempt + 1 >= 5)
        this.logger.error(
          `ALERT webhook ${key.provider}/${key.eventId} failed ${attempt + 1} times: ${String(e)}`,
        );
      throw e;
    }
  }

  private async handle(event: PaymentEvent) {
    const actor = { role: 'SYSTEM' as const, id: null };
    const opts = { handoverPepper: this.env.HANDOVER_CODE_PEPPER };
    switch (event.kind) {
      case 'payment.succeeded': {
        const order = await this.db.order.findFirst({
          where: { paymentIntentId: event.paymentIntentId },
        });
        if (!order) throw new Error(`No order for ${event.paymentIntentId}`);
        if (order.status !== 'CHECKOUT_PENDING') {
          if (order.chargeId) return; // already applied
          // Paid after the reservation expired: give the money back (SPEC §6.4 edge case).
          await this.provider.refund({
            paymentIntentId: event.paymentIntentId,
            amountCents: event.amountCents,
            orderId: order.id,
            idempotencyKey: `late-refund:${order.id}`,
          });
          this.logger.warn(`Late payment refunded for order ${order.number} (${order.status})`);
          return;
        }
        await this.db.$transaction(async (tx) => {
          await tx.order.update({ where: { id: order.id }, data: { chargeId: event.chargeId } });
          await applyOrderEvent(
            tx,
            order.id,
            { type: 'PAYMENT_SUCCEEDED', amountCents: event.amountCents, currency: event.currency },
            actor,
            opts,
          );
        });
        const fee = await this.provider.processorFee(event.chargeId);
        if (fee)
          await this.db.$transaction((tx) =>
            writeLedger(tx, order.id, processorFeeEntries(fee), `fee:${event.chargeId}`),
          );
        return;
      }
      case 'payment.failed': {
        const order = await this.db.order.findFirst({
          where: { paymentIntentId: event.paymentIntentId, status: 'CHECKOUT_PENDING' },
        });
        if (order)
          await this.db.$transaction((tx) =>
            applyOrderEvent(tx, order.id, { type: 'PAYMENT_FAILED' }, actor, opts),
          );
        return;
      }
      case 'account.updated': {
        const status = await this.provider.accountStatus(event.accountId);
        await this.db.paymentAccount.updateMany({
          where: { providerAccountId: event.accountId },
          data: {
            transfersEnabled: status.transfersEnabled,
            payoutsEnabled: status.payoutsEnabled,
            detailsSubmitted: status.detailsSubmitted,
            requirements: status.requirements as object,
            disabledReason: status.disabledReason,
          },
        });
        // Transfers held because the account was restricted can go now.
        if (status.transfersEnabled) await this.releaseHeldTransfers(event.accountId);
        return;
      }
      case 'dispute.created': {
        const order = await this.db.order.findFirst({ where: { chargeId: event.chargeId } });
        if (!order) return;
        await this.db.paymentDispute.upsert({
          where: { providerDisputeId: event.disputeId },
          create: {
            orderId: order.id,
            providerDisputeId: event.disputeId,
            amountCents: event.amountCents,
            reason: event.reason,
            status: 'needs_response',
            evidenceDueBy: event.evidenceDueBy,
          },
          update: {},
        });
        // SPEC §6.8: hold the transfer if it has not left yet; evidence handling in Phase 8.
        await this.db.order.updateMany({
          where: { id: order.id, payoutStatus: { in: ['NOT_DUE', 'SCHEDULED'] } },
          data: { payoutStatus: 'ON_HOLD' },
        });
        this.logger.warn(`Chargeback opened on order ${order.number}`);
        return;
      }
      default:
        return;
    }
  }

  private async releaseHeldTransfers(accountId: string) {
    const held = await this.db.order.findMany({
      where: {
        status: 'COMPLETED',
        payoutStatus: 'ON_HOLD',
        seller: { paymentAccount: { providerAccountId: accountId } },
        paymentDisputes: { none: {} },
      },
      select: { id: true, sellerNetCents: true, refundedCents: true },
    });
    for (const o of held) await this.transfer(o.id, o.sellerNetCents - o.refundedCents);
  }

  // ───────────── Order effects ─────────────

  private async effects(job: EffectsJob) {
    for (const effect of job.effects) {
      switch (effect.type) {
        case 'TRANSFER_TO_SELLER':
          await this.transfer(job.orderId, effect.amountCents);
          break;
        case 'REFUND':
          await this.refund(
            job.orderId,
            effect.amountCents,
            effect.includesBuyerFee,
            job.eventId ?? 'manual',
          );
          break;
        case 'CANCEL_PAYMENT_INTENT': {
          const o = await this.db.order.findUniqueOrThrow({ where: { id: job.orderId } });
          if (o.paymentIntentId)
            await this.provider
              .cancelPaymentIntent(o.paymentIntentId, `cancel:${o.id}`)
              .catch((e) =>
                // Already succeeded/cancelled: the webhook path handles a late success.
                this.logger.warn(`Cancel PaymentIntent ${o.paymentIntentId}: ${String(e)}`),
              );
          break;
        }
        case 'NOTIFY':
          await this.notify(job.orderId, effect.template, effect.to, job.eventId);
          break;
        default:
          // CREATE_SHIPPING_LABEL, REGISTER_TRACKING, CREATE_RETURN_LABEL: Phase 7;
          // OPEN_FEEDBACK: Phase 9 (feedback availability is derived from COMPLETED orders).
          break;
      }
    }
  }

  /** Transfer with `source_transaction` (SPEC §6.1); held while the seller account cannot receive. */
  private async transfer(orderId: string, amountCents: number) {
    const o = await this.db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { seller: { select: { paymentAccount: true } }, paymentDisputes: true },
    });
    if (o.transferId || amountCents <= 0) return;
    const account = o.seller.paymentAccount;
    if (!account?.transfersEnabled || o.paymentDisputes.length || !o.chargeId) {
      await this.db.order.update({ where: { id: o.id }, data: { payoutStatus: 'ON_HOLD' } });
      return;
    }
    const t = await this.provider.createTransfer({
      amountCents,
      currency: o.currency,
      destination: account.providerAccountId,
      sourceTransaction: o.chargeId,
      transferGroup: o.transferGroup,
      orderId: o.id,
      idempotencyKey: `transfer:${o.id}`,
    });
    await this.db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: o.id },
        data: { transferId: t.id, transferredAt: new Date(), payoutStatus: 'TRANSFERRED' },
      });
      await writeLedger(
        tx,
        o.id,
        transferToSellerEntries(amountCents, o.sellerId),
        `transfer:${o.id}`,
      );
    });
  }

  /** Refund keyed by the transition that caused it (SPEC §6.7: `refund:{orderId}:{n}`). */
  private async refund(orderId: string, amountCents: number, includesBuyerFee: boolean, n: string) {
    const key = `refund:${orderId}:${n}`;
    const o = await this.db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!o.paymentIntentId || amountCents <= 0) return;
    const done = await this.db.refund.findFirst({
      where: { orderId, reason: key, status: 'SUCCEEDED' },
    });
    if (done) return;
    const r = await this.provider.refund({
      paymentIntentId: o.paymentIntentId,
      amountCents,
      orderId,
      idempotencyKey: key,
    });
    await this.db.$transaction(async (tx) => {
      await tx.refund.upsert({
        where: { providerRefundId: r.id },
        create: {
          orderId,
          amountCents,
          reason: key,
          includesBuyerFee,
          providerRefundId: r.id,
          status: 'SUCCEEDED',
        },
        update: { status: 'SUCCEEDED' },
      });
      const fresh = await writeLedger(
        tx,
        orderId,
        includesBuyerFee && amountCents === o.totalCents
          ? fullRefundBeforeTransferEntries(paymentInputOf(o))
          : partialRefundEntries(amountCents, o.sellerId),
        key,
      );
      if (fresh)
        await tx.order.update({
          where: { id: orderId },
          data: { refundedCents: { increment: amountCents } },
        });
    });
  }

  private async notify(
    orderId: string,
    template: string,
    to: ReadonlyArray<string>,
    eventId?: string,
  ) {
    const o = await this.db.order.findUniqueOrThrow({ where: { id: orderId } });
    const text = ORDER_TEMPLATES[template];
    if (!text) return this.logger.warn(`No text for ${template}`);
    const title = (o.listingSnapshot as { title: string }).title;
    for (const party of to) {
      if (party === 'SUPPORT') {
        this.logger.warn(`SUPPORT ${template} order ${o.number}`); // back-office inbox in Phase 11
        continue;
      }
      const userId = party === 'BUYER' ? o.buyerId : o.sellerId;
      const [subject, body] = text(party as 'BUYER' | 'SELLER', title, o.number);
      await this.notifications.add(
        'order.notify',
        {
          userId,
          type: template,
          title: subject,
          body,
          path: `/account/${party === 'BUYER' ? 'acquisti' : 'vendite'}/${o.id}`,
          orderId: o.id,
        },
        {
          jobId: `order-notify:${eventId ?? orderId}:${template}:${party}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );
    }
  }
}
