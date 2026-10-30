import { describe, expect, it } from 'vitest';
import {
  evaluateListingChecks,
  findBannedTerms,
  isPriceAnomalous,
  median,
} from './listing-checks.js';

const samples = (n: number, price: number) => Array.from({ length: n }, () => price);

describe('median', () => {
  it('handles odd, even and empty sets', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('isPriceAnomalous', () => {
  it('flags prices under 35% of the median with at least 20 samples', () => {
    expect(isPriceAnomalous(34_000, samples(20, 100_000))).toBe(true);
    expect(isPriceAnomalous(35_000, samples(20, 100_000))).toBe(false);
  });
  it('needs enough samples', () => {
    expect(isPriceAnomalous(1, samples(19, 100_000))).toBe(false);
  });
});

describe('findBannedTerms', () => {
  it('matches whole words, ignoring case and accents', () => {
    expect(findBannedTerms('Chitarra con intarsi in AVORIO', ['avorio'])).toEqual(['avorio']);
    expect(findBannedTerms('Crack   del plugin', ['crack del plugin'])).toEqual([
      'crack del plugin',
    ]);
    expect(findBannedTerms('avoriobianco', ['avorio'])).toEqual([]);
    expect(findBannedTerms('Palissandro brasiliàno', ['palissandro brasiliano'])).toHaveLength(1);
  });
});

describe('evaluateListingChecks', () => {
  const base = {
    title: 'Fender Stratocaster',
    description: 'Ottime condizioni',
    priceCents: 80_000,
    comparablePricesCents: samples(30, 90_000),
    sellerAccountAgeDays: 400,
    hasImageFromOtherSeller: false,
    bannedTerms: ['replica'],
  };

  it('publishes a clean listing', () => {
    expect(evaluateListingChecks(base)).toEqual({
      status: 'ACTIVE',
      reasons: [],
      bannedTermsFound: [],
    });
  });

  it('collects every review reason', () => {
    const r = evaluateListingChecks({
      ...base,
      title: 'Stratocaster replica',
      priceCents: 250_000,
      comparablePricesCents: samples(30, 1_000_000),
      sellerAccountAgeDays: 3,
      hasImageFromOtherSeller: true,
    });
    expect(r.status).toBe('PENDING_REVIEW');
    expect(r.reasons).toEqual([
      'BANNED_TERMS',
      'ANOMALOUS_PRICE',
      'REUSED_IMAGES',
      'NEW_SELLER_HIGH_PRICE',
    ]);
  });
});
