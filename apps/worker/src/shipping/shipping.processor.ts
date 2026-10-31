import type { Prisma, PrismaClient } from '@accordo/db';
import type { OrderEvent } from '@accordo/domain';
import { applyOrderEvent } from '@accordo/orders';
import type { ShipmentStatusCode } from '@accordo/shipping';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ENV, type Env } from '../env.js';
import { PRISMA } from '../infra.js';
import { QUEUES } from '../queues.js';

interface StoredUpdate {
  shipmentId: string;
  status: ShipmentStatusCode;
  occurredAt: string;
  description?: string;
  location?: string;
}

const HANDED_OVER: ShipmentStatusCode[] = [
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'AVAILABLE_FOR_PICKUP',
  'DELIVERED',
];
const HOUR = 3_600_000;

/**
 * Tracking updates → `Shipment.status`/`events`; the first hand-over to the carrier confirms the
 * shipment, the delivery moves the order to DELIVERED, problems notify the parties (SPEC §7.3).
 */
@Processor(QUEUES.shipping)
export class ShippingProcessor extends WorkerHost {
  private readonly logger = new Logger(ShippingProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async process(job: Job) {
    const { provider, eventId } = job.data as { provider: string; eventId: string };
    const key = { provider_eventId: { provider, eventId } };
    const row = await this.db.webhookEvent.findUnique({ where: key });
    if (!row || row.processedAt) return;
    for (const u of (row.payload as unknown as { updates: StoredUpdate[] }).updates)
      await this.apply(u);
    await this.db.webhookEvent.update({
      where: key,
      data: { processedAt: new Date(), attempts: { increment: 1 } },
    });
  }

  async apply(u: StoredUpdate) {
    const s = await this.db.shipment.findUnique({ where: { providerShipmentId: u.shipmentId } });
    if (!s) return this.logger.warn(`Tracking update for unknown shipment ${u.shipmentId}`);
    const events = (s.events as unknown as StoredUpdate[]) ?? [];
    if (events.some((e) => e.status === u.status && e.occurredAt === u.occurredAt)) return;
    const at = new Date(u.occurredAt);
    await this.db.shipment.update({
      where: { id: s.id },
      data: {
        events: [...events, u] as unknown as Prisma.InputJsonValue,
        // A late "in transit" never overwrites a delivery.
        status: s.status === 'DELIVERED' ? 'DELIVERED' : u.status,
        ...(HANDED_OVER.includes(u.status) && !s.shippedAt ? { shippedAt: at } : {}),
        ...(u.status === 'DELIVERED' ? { deliveredAt: at } : {}),
      },
    });

    const opts = { handoverPepper: this.env.HANDOVER_CODE_PEPPER };
    const system = { role: 'SYSTEM' as const, id: null };
    const run = (event: OrderEvent) =>
      this.db.$transaction((tx) => applyOrderEvent(tx, s.orderId, event, system, opts));
    const order = () => this.db.order.findUniqueOrThrow({ where: { id: s.orderId } });

    if (s.direction === 'OUTBOUND') {
      if (HANDED_OVER.includes(u.status) && (await order()).status === 'PAID')
        await run({
          type: 'SHIPMENT_CONFIRMED',
          carrier: s.carrier ?? 'carrier',
          trackingNumber: s.trackingNumber ?? s.providerShipmentId ?? '',
          estimatedDeliveryAt: s.estimatedDeliveryAt,
        });
      if (u.status === 'DELIVERED' && (await order()).status === 'SHIPPED')
        await run({ type: 'DELIVERED', deliveredAt: at });
      if (u.status === 'EXCEPTION' || u.status === 'RETURNED_TO_SENDER')
        await this.db.outboxEvent.create({
          data: {
            aggregateType: 'Order',
            aggregateId: s.orderId,
            type: 'order.effects',
            payload: {
              orderId: s.orderId,
              eventId: `${u.status}:${u.occurredAt}`,
              effects: [
                {
                  type: 'NOTIFY',
                  template:
                    u.status === 'EXCEPTION'
                      ? 'order.shipping_exception'
                      : 'order.returned_to_sender',
                  to:
                    u.status === 'EXCEPTION' ? ['BUYER', 'SELLER'] : ['BUYER', 'SELLER', 'SUPPORT'],
                },
              ],
            },
          },
        });
      return;
    }

    // Return delivered to the seller: 48 hours to contest its condition, then refund (SPEC §6.6).
    if (u.status === 'DELIVERED') {
      const o = await order();
      if (o.status !== 'RETURN_IN_TRANSIT') return;
      const timings = await this.db.platformSetting.findUnique({ where: { key: 'orderTimings' } });
      const hours =
        (timings?.value as { returnInspectionHours?: number } | null)?.returnInspectionHours ?? 48;
      await this.db.order.updateMany({
        where: { id: o.id, version: o.version },
        data: {
          nextAction: 'RETURN_INSPECTION_DEADLINE',
          nextActionAt: new Date(at.getTime() + hours * HOUR),
          version: { increment: 1 },
        },
      });
    }
  }
}
