import type { PrismaClient } from '@accordo/db';
import { recomputeReputation } from '@accordo/orders';
import { type Meilisearch, syncListings } from '@accordo/search';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PRISMA, SEARCH } from './infra.js';
import { Notifier } from './notifications/notifier.js';
import { QUEUES } from './queues.js';

const DAY = 86_400_000;

interface FeedbackJob {
  feedbackId: string;
  recipientId: string;
  authorId: string;
  orderId: string;
  flags?: string[];
  reasonCode?: string;
  statement?: string;
}

@Injectable()
export class ReputationScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.reputation) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      'reputation-nightly',
      { pattern: '0 4 * * *', tz: 'Europe/Rome' },
      { name: 'nightly' },
    );
    await this.queue.upsertJobScheduler(
      'feedback-reminders',
      { pattern: '0 10 * * *', tz: 'Europe/Rome' },
      { name: 'reminders' },
    );
  }
}

/**
 * SPEC §8.4: incremental recomputation on feedback and order events, full recomputation every
 * night; search documents follow percentage and badge changes. Also reminders and revision expiry.
 */
@Processor(QUEUES.reputation)
export class ReputationProcessor extends WorkerHost {
  private readonly logger = new Logger(ReputationProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SEARCH) private readonly search: Meilisearch,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case 'nightly':
        return this.nightly(new Date());
      case 'reminders':
        return this.reminders(new Date());
      case 'order.completed': {
        const { buyerId, sellerId } = job.data as { buyerId: string; sellerId: string };
        for (const id of [buyerId, sellerId]) await this.recompute(id);
        return;
      }
      default:
        return this.feedbackEvent(job.name, job.data as FeedbackJob);
    }
  }

  async recompute(userId: string, now = new Date()) {
    const { changed } = await recomputeReputation(this.db, userId, now);
    if (!changed) return;
    // Cards show the seller's percentage and badge: refresh their live documents.
    const listings = await this.db.listing.findMany({
      where: { sellerId: userId, status: { in: ['ACTIVE', 'RESERVED'] }, deletedAt: null },
      select: { id: true },
    });
    for (let i = 0; i < listings.length; i += 500)
      await syncListings(
        this.search,
        this.db,
        listings.slice(i, i + 500).map((l) => l.id),
      ).catch((e) => this.logger.warn(`Search refresh for ${userId} failed: ${String(e)}`));
  }

  private async feedbackEvent(type: string, f: FeedbackJob) {
    await this.recompute(f.recipientId);
    const order = await this.db.order.findUnique({
      where: { id: f.orderId },
      select: { listingSnapshot: true, buyerId: true },
    });
    const title = (order?.listingSnapshot as { title?: string } | undefined)?.title ?? '';
    const received = {
      userId: f.recipientId,
      preference: 'feedback.received',
      type: 'feedback.received',
      title: 'Hai ricevuto un feedback',
      body: `Hai ricevuto un feedback per «${title}». Puoi rispondere una volta dalla pagina dei feedback.`,
      path: '/account/feedback',
      cta: 'Vedi il feedback',
      data: { feedbackId: f.feedbackId },
    };
    if (type === 'feedback.created' && !f.flags?.length) await this.notifier.notify(received);
    if (type === 'feedback.published') await this.notifier.notify(received);
    if (type === 'feedback.removed')
      for (const userId of [f.authorId, f.recipientId])
        await this.notifier.notify({
          userId,
          preference: 'feedback.received',
          mandatory: true,
          type: 'feedback.removed',
          title: 'Feedback rimosso',
          body: `Un feedback relativo a «${title}» è stato rimosso dallo staff (motivo: ${f.reasonCode}). ${f.statement ?? ''}`,
          path: '/account/feedback',
          data: { feedbackId: f.feedbackId, reasonCode: f.reasonCode },
        });
  }

  /** Everyone with feedback or completed orders; also expires revision requests. */
  async nightly(now: Date) {
    const expired = await this.db.feedbackRevisionRequest.updateMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });
    const users = await this.db.user.findMany({
      where: {
        OR: [
          { feedbackReceived: { some: {} } },
          { sales: { some: { status: 'COMPLETED' } } },
          { purchases: { some: { status: 'COMPLETED' } } },
          { reputation: { isNot: null } },
        ],
      },
      select: { id: true },
    });
    for (const u of users) await this.recompute(u.id, now);
    this.logger.log(
      `reputation: ${users.length} users recomputed, ${expired.count} revision requests expired`,
    );
    return { users: users.length, expired: expired.count };
  }

  /** SPEC §8.1: reminders on day 3 and day 30 after completion to whoever hasn't left feedback. */
  async reminders(now: Date) {
    let sent = 0;
    for (const day of [3, 30]) {
      const to = new Date(now.getTime() - day * DAY);
      const orders = await this.db.order.findMany({
        where: { status: 'COMPLETED', completedAt: { gt: new Date(to.getTime() - DAY), lte: to } },
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          listingSnapshot: true,
          feedback: { select: { authorId: true } },
        },
      });
      for (const o of orders)
        for (const userId of [o.buyerId, o.sellerId]) {
          if (o.feedback.some((f) => f.authorId === userId)) continue;
          await this.notifier.notify({
            userId,
            preference: 'feedback.reminder',
            type: 'feedback.reminder',
            title: "Com'è andata?",
            body: `Lascia un feedback per «${(o.listingSnapshot as { title?: string }).title ?? ''}»: aiuta gli altri utenti a scegliere con fiducia.`,
            path: '/account/feedback',
            cta: 'Lascia un feedback',
            data: { orderId: o.id },
          });
          sent++;
        }
    }
    return { sent };
  }
}
