import type { PrismaClient } from '@accordo/db';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PRISMA } from './infra.js';
import { Notifier } from './notifications/notifier.js';
import { QUEUES } from './queues.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

@Injectable()
export class LifecycleScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.lifecycle) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      'listing-lifecycle-hourly',
      { pattern: '5 * * * *', tz: 'Europe/Rome' },
      { name: 'run' },
    );
  }
}

/** Hourly (SPEC §3.3): reminders 7 days and 1 day before expiry, then expiry. */
@Processor(QUEUES.lifecycle)
export class LifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(LifecycleProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  async process(): Promise<{ reminded: number; expired: number }> {
    return this.run(new Date());
  }

  async run(now: Date): Promise<{ reminded: number; expired: number }> {
    let reminded = 0;
    // ponytail: one-hour windows matched by an hourly job; a missed run skips that reminder (expiry is never skipped).
    for (const days of [7, 1]) {
      const to = new Date(now.getTime() + days * DAY);
      const due = await this.db.listing.findMany({
        where: { status: 'ACTIVE', expiresAt: { gt: new Date(to.getTime() - HOUR), lte: to } },
        select: { id: true, title: true, sellerId: true },
      });
      for (const l of due) {
        await this.notifier.notify({
          userId: l.sellerId,
          preference: 'listing.lifecycle',
          type: 'listing.expiring',
          title: days === 1 ? 'Il tuo annuncio scade domani' : 'Il tuo annuncio scade tra 7 giorni',
          body: `«${l.title}» sta per scadere. Rinnovalo gratis per altri 60 giorni.`,
          path: '/account/annunci',
          cta: 'Rinnova',
          data: { listingId: l.id, days },
        });
        reminded++;
      }
    }

    const expiring = await this.db.listing.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true, title: true, sellerId: true },
    });
    for (const l of expiring) {
      await this.db.$transaction([
        this.db.listing.update({ where: { id: l.id }, data: { status: 'EXPIRED' } }),
        this.db.outboxEvent.create({
          data: {
            aggregateType: 'Listing',
            aggregateId: l.id,
            type: 'listing.expired',
            payload: { listingId: l.id },
          },
        }),
      ]);
      await this.notifier.notify({
        userId: l.sellerId,
        preference: 'listing.lifecycle',
        type: 'listing.expired',
        title: 'Annuncio scaduto',
        body: `«${l.title}» è scaduto e non è più visibile. Puoi rinnovarlo gratis quando vuoi.`,
        path: '/account/annunci',
        cta: 'Rinnova',
        data: { listingId: l.id },
      });
    }
    if (reminded || expiring.length)
      this.logger.log(`lifecycle: ${reminded} reminders, ${expiring.length} expired`);
    return { reminded, expired: expiring.length };
  }
}
