import type { PrismaClient } from '@accordo/db';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PRISMA } from '../infra.js';
import { QUEUES } from '../queues.js';
import { Notifier } from './notifier.js';

const euro = (cents: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const listingPath = (l: { slug: string; shortId: string }) => `/annuncio/${l.slug}-${l.shortId}`;

/** Domain events → recipients and Italian texts. */
@Processor(QUEUES.notifications)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly notifier: Notifier,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { listingId } = job.data as { listingId: string };
    const listing = await this.db.listing.findUnique({
      where: { id: listingId },
      select: { id: true, title: true, slug: true, shortId: true, sellerId: true },
    });
    if (!listing) return;

    if (job.name === 'listing.review_pending') {
      await this.notifier.notify({
        userId: listing.sellerId,
        preference: 'listing.moderation',
        mandatory: true,
        type: 'listing.review_pending',
        title: 'Annuncio in revisione',
        body: `Il tuo annuncio «${listing.title}» verrà controllato dal nostro staff prima della pubblicazione. Ti avviseremo appena possibile.`,
        path: '/account/annunci',
        data: { listingId },
      });
    }

    if (job.name === 'listing.price_dropped') {
      const { fromCents, toCents } = job.data as { fromCents: number; toCents: number };
      const fans = await this.db.favorite.findMany({
        where: { listingId, userId: { not: listing.sellerId } },
        select: { userId: true },
      });
      for (const { userId } of fans) {
        await this.notifier.notify({
          userId,
          preference: 'favorite.price_drop',
          type: 'favorite.price_drop',
          title: 'Prezzo ribassato',
          body: `«${listing.title}» è sceso da ${euro(fromCents)} a ${euro(toCents)}.`,
          path: listingPath(listing),
          cta: "Vedi l'annuncio",
          data: { listingId },
        });
      }
    }
  }
}
