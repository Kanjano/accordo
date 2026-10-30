import { describe, expect, it } from 'vitest';
import { counterProposer, minOfferCents, offerActionError, offerAmountError } from './offers.js';

const now = new Date('2026-11-01T10:00:00Z');
const offer = {
  status: 'PENDING',
  buyerId: 'b',
  sellerId: 's',
  proposedById: 'b',
  expiresAt: new Date(now.getTime() + 3_600_000),
};

describe('offer amounts', () => {
  it('requires at least the minimum percentage and at most the price', () => {
    expect(minOfferCents(10_001, 50)).toBe(5001);
    expect(offerAmountError(5000, 10_000, 50)).toBeNull();
    expect(offerAmountError(4999, 10_000, 50)).toBe('OFFER_TOO_LOW');
    expect(offerAmountError(10_001, 10_000, 50)).toBe('OFFER_ABOVE_PRICE');
    expect(offerAmountError(5000.5, 10_000, 50)).toBe('OFFER_TOO_LOW');
  });
});

describe('offer actions', () => {
  it('lets only the recipient accept, decline or counter, and only the proposer withdraw', () => {
    for (const action of ['accept', 'decline', 'counter'] as const) {
      expect(offerActionError(offer, 's', action, now)).toBeNull();
      expect(offerActionError(offer, 'b', action, now)).toBe('NOT_RECIPIENT');
    }
    expect(offerActionError(offer, 'b', 'withdraw', now)).toBeNull();
    expect(offerActionError(offer, 's', 'withdraw', now)).toBe('NOT_PROPOSER');
    expect(offerActionError(offer, 'x', 'accept', now)).toBe('NOT_PARTY');
  });

  it('rejects actions on answered or expired offers', () => {
    expect(offerActionError({ ...offer, status: 'ACCEPTED' }, 's', 'accept', now)).toBe(
      'OFFER_NOT_PENDING',
    );
    expect(offerActionError({ ...offer, expiresAt: now }, 's', 'accept', now)).toBe(
      'OFFER_EXPIRED',
    );
  });

  it('alternates the proposer along counter-offers', () => {
    expect(counterProposer(offer)).toBe('s');
    expect(counterProposer({ ...offer, proposedById: 's' })).toBe('b');
  });
});
