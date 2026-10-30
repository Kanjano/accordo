export type OfferAction = 'accept' | 'decline' | 'counter' | 'withdraw';

export interface OfferSnapshot {
  status: string;
  buyerId: string;
  sellerId: string;
  proposedById: string;
  expiresAt: Date;
}

/** Lowest acceptable offer (SPEC §3.6: minimum percentage of the price, rounded up). */
export function minOfferCents(priceCents: number, minPercent: number): number {
  return Math.ceil((priceCents * minPercent) / 100);
}

/** Error code for an amount outside [minimum, price], or null when valid. */
export function offerAmountError(
  amountCents: number,
  priceCents: number,
  minPercent: number,
): 'OFFER_TOO_LOW' | 'OFFER_ABOVE_PRICE' | null {
  if (!Number.isSafeInteger(amountCents) || amountCents < minOfferCents(priceCents, minPercent))
    return 'OFFER_TOO_LOW';
  if (amountCents > priceCents) return 'OFFER_ABOVE_PRICE';
  return null;
}

/**
 * Who may do what on a pending offer: the proposer can only withdraw, the other party can accept,
 * decline or counter. Returns an error code, or null when allowed.
 */
export function offerActionError(
  offer: OfferSnapshot,
  actorId: string,
  action: OfferAction,
  now: Date,
): 'NOT_PARTY' | 'OFFER_NOT_PENDING' | 'OFFER_EXPIRED' | 'NOT_PROPOSER' | 'NOT_RECIPIENT' | null {
  if (actorId !== offer.buyerId && actorId !== offer.sellerId) return 'NOT_PARTY';
  if (offer.status !== 'PENDING') return 'OFFER_NOT_PENDING';
  if (offer.expiresAt.getTime() <= now.getTime()) return 'OFFER_EXPIRED';
  const isProposer = actorId === offer.proposedById;
  if (action === 'withdraw') return isProposer ? null : 'NOT_PROPOSER';
  return isProposer ? 'NOT_RECIPIENT' : null;
}

/** The party a counter-offer comes from (the recipient of the countered offer). */
export function counterProposer(offer: OfferSnapshot): string {
  return offer.proposedById === offer.buyerId ? offer.sellerId : offer.buyerId;
}
