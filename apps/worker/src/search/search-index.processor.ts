import type { PrismaClient } from '@accordo/db';
import { ensureIndexes, type Meilisearch, syncCatalog, syncListings } from '@accordo/search';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PRISMA, SEARCH } from '../infra.js';
import { QUEUES } from '../queues.js';

@Injectable()
export class SearchIndexBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchIndexBootstrap.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SEARCH) private readonly search: Meilisearch,
    @InjectQueue(QUEUES.searchIndex) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap() {
    // Brand counts drive autocomplete ranking: refreshed hourly.
    await this.queue.upsertJobScheduler(
      'search-catalog-hourly',
      { pattern: '15 * * * *', tz: 'Europe/Rome' },
      { name: 'catalog.sync' },
    );
    // Meilisearch down at boot must not stop the worker: indexing jobs retry on their own.
    await ensureIndexes(this.search, this.db).catch((e) =>
      this.logger.warn(`Search indexes not ready: ${String(e)}`),
    );
  }
}

/**
 * `listing.*` events → upsert or removal of the document, from the current database state
 * (idempotent). Concurrency 1 keeps Meilisearch tasks in event order.
 */
@Processor(QUEUES.searchIndex, { concurrency: 1 })
export class SearchIndexProcessor extends WorkerHost {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(SEARCH) private readonly search: Meilisearch,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'catalog.sync') return syncCatalog(this.search, this.db);
    const { listingId } = job.data as { listingId?: string };
    if (listingId) return syncListings(this.search, this.db, [listingId]);
  }
}
