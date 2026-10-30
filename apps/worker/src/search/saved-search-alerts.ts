import type { PrismaClient } from '@accordo/db';
import { type Meilisearch, searchListings } from '@accordo/search';
import { searchParamsSchema } from '@accordo/shared';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PRISMA, SEARCH } from '../infra.js';
import { Notifier } from '../notifications/notifier.js';
import { QUEUES } from '../queues.js';

type Frequency = 'INSTANT' | 'DAILY';
const euro = (cents: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);

@Injectable()
export class SavedSearchScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.savedSearchAlerts) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      'saved-search-instant',
      { pattern: '*/10 * * * *', tz: 'Europe/Rome' },
      { name: 'INSTANT' },
    );
    await this.queue.upsertJobScheduler(
      'saved-search-daily',
      { pattern: '0 8 * * *', tz: 'Europe/Rome' },
      { name: 'DAILY' },
    );
  }
}

/**
 * SPEC §9.3: re-runs each saved search for listings published after the last notified one.
 * ponytail: one query per saved search; see ADR-0032 for the reverse-search ("percolation") path.
 */
@Processor(QUEUES.savedSearchAlerts)
export class SavedSearchAlertsProcessor extends WorkerHost {
  private readonly logger = new Logger(SavedSearchAlertsProcessor.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SEARCH) private readonly search: Meilisearch,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  process(job: Job) {
    return this.run(job.name as Frequency);
  }

  async run(frequency: Frequency): Promise<{ notified: number }> {
    let notified = 0;
    let cursor = '';
    for (;;) {
      const batch = await this.db.savedSearch.findMany({
        where: { alertFrequency: frequency, id: { gt: cursor }, user: { status: 'ACTIVE' } },
        orderBy: { id: 'asc' },
        take: 200,
      });
      if (!batch.length) break;
      cursor = batch.at(-1)?.id as string;
      for (const s of batch) if (await this.alert(s)) notified++;
    }
    if (notified) this.logger.log(`saved searches (${frequency}): ${notified} alerts`);
    return { notified };
  }

  private async alert(s: {
    id: string;
    userId: string;
    name: string;
    query: unknown;
    lastNotifiedAt: Date | null;
    createdAt: Date;
  }): Promise<boolean> {
    const parsed = searchParamsSchema.safeParse(s.query);
    if (!parsed.success) return false;
    const since = Math.floor((s.lastNotifiedAt ?? s.createdAt).getTime() / 1000);
    const res = await searchListings(
      this.search,
      this.db,
      { ...parsed.data, page: 1, hitsPerPage: 20 },
      {
        filter: [`publishedAt > ${since}`, `sellerId != "${s.userId}"`],
        sort: ['publishedAt:desc'],
      },
    );
    if (!res.total) return false;

    const top = res.hits.slice(0, 3).map((h) => `${h.title} (${euro(h.priceCents)})`);
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(s.query as Record<string, string | string[]>))
      for (const value of [v].flat()) query.append(k, value);
    await this.notifier.notify({
      userId: s.userId,
      preference: 'saved_search.results',
      type: 'saved_search.results',
      title:
        res.total === 1
          ? `Un nuovo annuncio per «${s.name}»`
          : `${res.total} nuovi annunci per «${s.name}»`,
      body: `${top.join(', ')}${res.total > 3 ? ' e altri.' : '.'}`,
      path: `/annunci?${query}`,
      cta: 'Vedi gli annunci',
      data: { savedSearchId: s.id, count: res.total },
    });
    // The newest notified listing is the next lower bound: no duplicates across runs.
    const newest = Math.max(...res.hits.map((h) => Date.parse(h.publishedAt as string)));
    await this.db.savedSearch.update({
      where: { id: s.id },
      data: { lastNotifiedAt: new Date(newest) },
    });
    return true;
  }
}
