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

interface MessagePayload {
  messageId: string;
  conversationId: string;
  recipientId: string;
  firstUnread: boolean;
}
interface OfferPayload {
  offerId: string;
  conversationId: string;
  recipientId: string;
}

const OFFER_TEXTS: Record<string, (title: string, amount: string) => [string, string]> = {
  'offer.created': (t, a) => ['Nuova offerta', `Hai ricevuto un'offerta di ${a} per «${t}».`],
  'offer.countered': (t, a) => [
    'Controproposta',
    `Hai ricevuto una controproposta di ${a} per «${t}».`,
  ],
  'offer.accepted': (t, a) => [
    'Offerta accettata',
    `L'offerta di ${a} per «${t}» è stata accettata: l'annuncio è riservato per 24 ore in attesa del pagamento.`,
  ],
  'offer.declined': (t, a) => [
    'Offerta rifiutata',
    `L'offerta di ${a} per «${t}» è stata rifiutata.`,
  ],
  'offer.withdrawn': (t, a) => [
    'Offerta ritirata',
    `L'offerta di ${a} per «${t}» è stata ritirata.`,
  ],
  'offer.expired': (t, a) => ['Offerta scaduta', `L'offerta di ${a} per «${t}» è scaduta.`],
};

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
    if (job.name === 'order.notify') {
      const n = job.data as {
        userId: string;
        type: string;
        title: string;
        body: string;
        path: string;
        orderId: string;
      };
      // Order updates are transactional: never opted out (SPEC §3.9).
      return this.notifier.notify({
        userId: n.userId,
        preference: 'order.updates',
        mandatory: true,
        type: n.type,
        title: n.title,
        body: n.body,
        path: n.path,
        cta: "Vedi l'ordine",
        data: { orderId: n.orderId },
      });
    }
    if (job.name === 'message.created') return this.message(job.data as MessagePayload);
    if (job.name.startsWith('offer.')) return this.offer(job.name, job.data as OfferPayload);
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

  /** One notification per burst: only when the conversation had no unread messages (no spam). */
  private async message(p: MessagePayload) {
    if (!p.firstUnread) return;
    const m = await this.db.message.findUnique({
      where: { id: p.messageId },
      select: {
        body: true,
        sender: { select: { name: true } },
        conversation: { select: { listing: { select: { title: true } } } },
      },
    });
    if (!m) return;
    const preview = (m.body ?? '').replace(/\s+/g, ' ').slice(0, 140);
    await this.notifier.notify({
      userId: p.recipientId,
      preference: 'message.new',
      type: 'message.new',
      title: `Nuovo messaggio da ${m.sender?.name ?? 'un utente'}`,
      body: `«${m.conversation.listing.title}»: ${preview}`,
      path: `/messaggi/${p.conversationId}`,
      cta: 'Rispondi',
      data: { conversationId: p.conversationId },
    });
  }

  private async offer(event: string, p: OfferPayload) {
    const texts = OFFER_TEXTS[event];
    const offer = await this.db.offer.findUnique({
      where: { id: p.offerId },
      select: { amountCents: true, listing: { select: { title: true } } },
    });
    if (!texts || !offer) return;
    const [title, body] = texts(offer.listing.title, euro(offer.amountCents));
    await this.notifier.notify({
      userId: p.recipientId,
      preference: 'offer.updates',
      type: event,
      title,
      body,
      path: `/messaggi/${p.conversationId}`,
      cta: 'Apri la conversazione',
      data: { offerId: p.offerId, conversationId: p.conversationId },
    });
  }
}
