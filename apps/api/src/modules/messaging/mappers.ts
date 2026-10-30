import type { Prisma } from '@accordo/db';
import type {
  ConversationListing,
  ConversationSummary,
  MessageItem,
  MessageType,
  OfferItem,
  OfferStatus,
} from '@accordo/shared';

/** Flags that show the "pay only with protected payment" warning to the recipient (SPEC §13.4). */
export const WARN_FLAGS = ['LINK', 'IBAN', 'OFF_PLATFORM_PAYMENT', 'MESSAGING_APP'];

export const listingSelect = {
  id: true,
  shortId: true,
  slug: true,
  title: true,
  priceCents: true,
  status: true,
  isNegotiable: true,
  protectedPaymentEnabled: true,
  images: {
    where: { width: { gt: 0 } },
    orderBy: { position: 'asc' },
    take: 1,
    select: { storageKey: true },
  },
} satisfies Prisma.ListingSelect;

export function toListing(
  l: Prisma.ListingGetPayload<{ select: typeof listingSelect }>,
): ConversationListing {
  return {
    id: l.id,
    shortId: l.shortId,
    slug: l.slug,
    title: l.title,
    priceCents: l.priceCents,
    status: l.status,
    imageKey: l.images[0]?.storageKey ?? null,
    isNegotiable: l.isNegotiable,
    protectedPaymentEnabled: l.protectedPaymentEnabled,
  };
}

type OfferRow = Prisma.OfferGetPayload<object>;

export function toOffer(o: OfferRow): OfferItem {
  return {
    id: o.id,
    listingId: o.listingId,
    buyerId: o.buyerId,
    sellerId: o.sellerId,
    proposedById: o.proposedById,
    amountCents: o.amountCents,
    status: o.status as OfferStatus,
    parentOfferId: o.parentOfferId,
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
  };
}

export function toMessage(m: Prisma.MessageGetPayload<{ include: { offer: true } }>): MessageItem {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type as MessageType,
    body: m.body,
    flags: m.flags,
    warn: m.flags.some((f) => WARN_FLAGS.includes(f)),
    offer: m.offer ? toOffer(m.offer) : null,
    readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export const conversationInclude = {
  listing: { select: listingSelect },
  buyer: { select: { id: true, username: true, name: true } },
  seller: { select: { id: true, username: true, name: true } },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    where: { isHidden: false },
    select: { type: true, body: true, senderId: true },
  },
} satisfies Prisma.ConversationInclude;
export type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export function toSummary(c: ConversationRow, userId: string): ConversationSummary {
  const isBuyer = c.buyerId === userId;
  const last = c.messages[0];
  return {
    id: c.id,
    role: isBuyer ? 'BUYER' : 'SELLER',
    listing: toListing(c.listing),
    otherParty: isBuyer ? c.seller : c.buyer,
    lastMessage: last ? { ...last, type: last.type as MessageType } : null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    unread: isBuyer ? c.buyerUnread : c.sellerUnread,
    archived: !!(isBuyer ? c.buyerArchivedAt : c.sellerArchivedAt),
  };
}
