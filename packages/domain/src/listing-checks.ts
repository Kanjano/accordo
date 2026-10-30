export interface ListingCheckSettings {
  /** Below this share of the (category, brand) median the price is anomalous. Default 35%. */
  anomalousPriceBps: number;
  anomalousPriceMinSamples: number;
  newSellerDays: number;
  newSellerReviewAboveCents: number;
}

export const DEFAULT_LISTING_CHECK_SETTINGS: ListingCheckSettings = {
  anomalousPriceBps: 3500,
  anomalousPriceMinSamples: 20,
  newSellerDays: 30,
  newSellerReviewAboveCents: 200_000,
};

export type ListingReviewReason =
  | 'BANNED_TERMS'
  | 'ANOMALOUS_PRICE'
  | 'REUSED_IMAGES'
  | 'NEW_SELLER_HIGH_PRICE';

export interface ListingCheckInput {
  title: string;
  description: string;
  priceCents: number;
  /** Prices of comparable listings (same category and brand). */
  comparablePricesCents: readonly number[];
  sellerAccountAgeDays: number;
  /** True when an image matches (Hamming ≤ 6) a photo of another seller. */
  hasImageFromOtherSeller: boolean;
  bannedTerms: readonly string[];
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // biome-ignore lint/style/noNonNullAssertion: indexes are within bounds
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** SPEC §13.5: price under 35% of the median of at least 20 samples. */
export function isPriceAnomalous(
  priceCents: number,
  comparablePricesCents: readonly number[],
  s: Pick<
    ListingCheckSettings,
    'anomalousPriceBps' | 'anomalousPriceMinSamples'
  > = DEFAULT_LISTING_CHECK_SETTINGS,
): boolean {
  if (comparablePricesCents.length < s.anomalousPriceMinSamples) return false;
  const m = median(comparablePricesCents);
  return m !== null && priceCents * 10_000 < m * s.anomalousPriceBps;
}

const fold = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Banned terms matched as whole words, case and accent insensitive. */
export function findBannedTerms(text: string, terms: readonly string[]): string[] {
  const haystack = fold(text);
  return terms.filter((term) => {
    const escaped = fold(term)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(haystack);
  });
}

/** Automatic publication checks: ACTIVE when clean, otherwise PENDING_REVIEW with reasons. */
export function evaluateListingChecks(
  input: ListingCheckInput,
  s: ListingCheckSettings = DEFAULT_LISTING_CHECK_SETTINGS,
): {
  status: 'ACTIVE' | 'PENDING_REVIEW';
  reasons: ListingReviewReason[];
  bannedTermsFound: string[];
} {
  const reasons: ListingReviewReason[] = [];
  const bannedTermsFound = findBannedTerms(
    `${input.title}\n${input.description}`,
    input.bannedTerms,
  );
  if (bannedTermsFound.length) reasons.push('BANNED_TERMS');
  if (isPriceAnomalous(input.priceCents, input.comparablePricesCents, s))
    reasons.push('ANOMALOUS_PRICE');
  if (input.hasImageFromOtherSeller) reasons.push('REUSED_IMAGES');
  if (
    input.sellerAccountAgeDays < s.newSellerDays &&
    input.priceCents > s.newSellerReviewAboveCents
  ) {
    reasons.push('NEW_SELLER_HIGH_PRICE');
  }
  return { status: reasons.length ? 'PENDING_REVIEW' : 'ACTIVE', reasons, bannedTermsFound };
}
