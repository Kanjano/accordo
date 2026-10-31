import type { DeliveryMethod } from './amounts.js';
import { BUSINESS_TIMEZONE } from './business-days.js';
import { divRoundHalfUp } from './money.js';
import { scanMessage } from './scan-message.js';

export type FeedbackRole = 'BUYER_TO_SELLER' | 'SELLER_TO_BUYER';
export type FeedbackRating = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
export type FeedbackStatus = 'PUBLISHED' | 'HIDDEN' | 'REMOVED';

export interface ReputationSettings {
  feedbackMinOrderCents: number;
  feedbackWindowDays: number;
}

export const DEFAULT_REPUTATION_SETTINGS: ReputationSettings = {
  feedbackMinOrderCents: 300,
  feedbackWindowDays: 60,
};

const DAY = 86_400_000;
const RATING_RANK: Record<FeedbackRating, number> = { NEGATIVE: 0, NEUTRAL: 1, POSITIVE: 2 };

/** ISO week of the order completion on the Europe/Rome calendar, e.g. "2026-W44". */
export function weekKey(date: Date): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(
    BUSINESS_TIMEZONE,
  );
  // biome-ignore lint/style/noNonNullAssertion: always defined for the ISO 8601 calendar
  return `${zoned.yearOfWeek!}-W${String(zoned.weekOfYear!).padStart(2, '0')}`;
}

// ───────────────────────── Leaving feedback ─────────────────────────

export function canLeaveFeedback(
  order: { status: string; completedAt: Date | null },
  now: Date,
  s: ReputationSettings = DEFAULT_REPUTATION_SETTINGS,
): { ok: true } | { ok: false; reason: 'ORDER_NOT_COMPLETED' | 'WINDOW_CLOSED' } {
  if (order.status !== 'COMPLETED' || !order.completedAt)
    return { ok: false, reason: 'ORDER_NOT_COMPLETED' };
  if (now.getTime() > order.completedAt.getTime() + s.feedbackWindowDays * DAY)
    return { ok: false, reason: 'WINDOW_CLOSED' };
  return { ok: true };
}

export interface DetailedRatings {
  itemAsDescribed?: number | null;
  communication?: number | null;
  shippingTime?: number | null;
  packaging?: number | null;
}

export type FeedbackInputError =
  | 'SELLER_ONLY_POSITIVE'
  | 'COMMENT_REQUIRED'
  | 'COMMENT_LENGTH'
  | 'DSR_NOT_ALLOWED'
  | 'DSR_REQUIRED'
  | 'DSR_RANGE';

/** SPEC §8.2 content rules. Returns the list of violations (empty when valid). */
export function validateFeedbackInput(input: {
  role: FeedbackRole;
  rating: FeedbackRating;
  comment?: string | null;
  dsr?: DetailedRatings;
  deliveryMethod: DeliveryMethod;
}): FeedbackInputError[] {
  const errors: FeedbackInputError[] = [];
  const comment = input.comment?.trim() ?? '';
  const dsr = input.dsr ?? {};
  const values = [dsr.itemAsDescribed, dsr.communication, dsr.shippingTime, dsr.packaging];

  if (input.role === 'SELLER_TO_BUYER') {
    if (input.rating !== 'POSITIVE') errors.push('SELLER_ONLY_POSITIVE');
    if (comment.length > 500) errors.push('COMMENT_LENGTH');
    if (values.some((v) => v != null)) errors.push('DSR_NOT_ALLOWED');
    return errors;
  }

  if (input.rating === 'POSITIVE') {
    if (comment.length > 500) errors.push('COMMENT_LENGTH');
  } else if (!comment) {
    errors.push('COMMENT_REQUIRED');
  } else if (comment.length < 20 || comment.length > 500) {
    errors.push('COMMENT_LENGTH');
  }

  const handDelivery = input.deliveryMethod === 'HAND_DELIVERY';
  const required = handDelivery ? [dsr.itemAsDescribed, dsr.communication] : values;
  if (handDelivery && (dsr.shippingTime != null || dsr.packaging != null))
    errors.push('DSR_NOT_ALLOWED');
  if (required.some((v) => v == null)) errors.push('DSR_REQUIRED');
  if (values.some((v) => v != null && (!Number.isInteger(v) || v < 1 || v > 5)))
    errors.push('DSR_RANGE');
  return errors;
}

// ───────────────────────── Calculations ─────────────────────────

export interface FeedbackRecord {
  id: string;
  authorId: string;
  recipientId: string;
  role: FeedbackRole;
  rating: FeedbackRating;
  status: FeedbackStatus;
  orderItemPriceCents: number;
  weekKey: string;
  createdAt: Date;
  dsrItemAsDescribed?: number | null;
  dsrCommunication?: number | null;
  dsrShippingTime?: number | null;
  dsrPackaging?: number | null;
}

const groupKey = (f: FeedbackRecord) => `${f.authorId}|${f.recipientId}|${f.role}|${f.weekKey}`;

/** Ids of the feedback that count: first published one per (author, recipient, role, ISO week). */
export function countableFeedbackIds(
  feedback: readonly FeedbackRecord[],
  s: ReputationSettings = DEFAULT_REPUTATION_SETTINGS,
): Set<string> {
  const firstByGroup = new Map<string, FeedbackRecord>();
  for (const f of feedback) {
    if (f.status !== 'PUBLISHED') continue;
    const prev = firstByGroup.get(groupKey(f));
    if (
      !prev ||
      f.createdAt < prev.createdAt ||
      (f.createdAt.getTime() === prev.createdAt.getTime() && f.id < prev.id)
    ) {
      firstByGroup.set(groupKey(f), f);
    }
  }
  return new Set(
    [...firstByGroup.values()]
      .filter((f) => f.orderItemPriceCents >= s.feedbackMinOrderCents)
      .map((f) => f.id),
  );
}

export const LEVELS = [
  { key: 'LEGEND', min: 5000 },
  { key: 'MAESTRO', min: 1000 },
  { key: 'PROFESSIONAL', min: 500 },
  { key: 'SOLOIST', min: 100 },
  { key: 'SESSION_PLAYER', min: 50 },
  { key: 'NEWCOMER', min: 10 },
] as const;
export type LevelKey = (typeof LEVELS)[number]['key'];

export function levelFor(score: number): LevelKey | null {
  return LEVELS.find((l) => score >= l.min)?.key ?? null;
}

type DsrKey = 'ItemAsDescribed' | 'Communication' | 'ShippingTime' | 'Packaging';
const DSR_KEYS: readonly DsrKey[] = [
  'ItemAsDescribed',
  'Communication',
  'ShippingTime',
  'Packaging',
];

export interface ReputationSummary {
  score: number;
  levelKey: LevelKey | null;
  sellerPositive12m: number;
  sellerNeutral12m: number;
  sellerNegative12m: number;
  /** positives / (positives + negatives) in basis points; null without feedback. */
  sellerPositivePctBps: number | null;
  buyerPositive12m: number;
  dsr: Record<DsrKey, { avg: number | null; count: number; sum: number }>;
}

/** SPEC §8.4: computes a user's reputation from all feedback they received. */
export function computeReputation(
  received: readonly FeedbackRecord[],
  now: Date,
  s: ReputationSettings = DEFAULT_REPUTATION_SETTINGS,
): ReputationSummary {
  const countable = countableFeedbackIds(received, s);
  const since = now.getTime() - 365 * DAY;
  let score = 0;
  let pos = 0;
  let neu = 0;
  let neg = 0;
  let buyerPos = 0;
  const dsr = Object.fromEntries(
    DSR_KEYS.map((k) => [k, { avg: null, count: 0, sum: 0 }]),
  ) as ReputationSummary['dsr'];

  for (const f of received) {
    if (!countable.has(f.id)) continue;
    score += f.rating === 'POSITIVE' ? 1 : f.rating === 'NEGATIVE' ? -1 : 0;
    if (f.createdAt.getTime() < since) continue;
    if (f.role === 'SELLER_TO_BUYER') {
      if (f.rating === 'POSITIVE') buyerPos++;
      continue;
    }
    if (f.rating === 'POSITIVE') pos++;
    else if (f.rating === 'NEUTRAL') neu++;
    else neg++;
    for (const k of DSR_KEYS) {
      const v = f[`dsr${k}`];
      if (v != null) {
        dsr[k].count++;
        dsr[k].sum += v;
      }
    }
  }
  for (const k of DSR_KEYS) {
    if (dsr[k].count) dsr[k].avg = divRoundHalfUp(dsr[k].sum * 100, dsr[k].count) / 100;
  }

  return {
    score,
    levelKey: levelFor(score),
    sellerPositive12m: pos,
    sellerNeutral12m: neu,
    sellerNegative12m: neg,
    sellerPositivePctBps: pos + neg ? divRoundHalfUp(pos * 10_000, pos + neg) : null,
    buyerPositive12m: buyerPos,
    dsr,
  };
}

/** Detailed ratings are shown only with at least 5 ratings for that criterion. */
export const DSR_MIN_DISPLAY_COUNT = 5;

/** "99,4%" style display value, one decimal. */
export function formatPositivePct(bps: number | null, locale = 'it-IT'): string | null {
  return bps === null
    ? null
    : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bps / 100)}%`;
}

// ───────────────────────── Top Seller ─────────────────────────

export interface TopSellerSettings {
  minAccountAgeDays: number;
  minSales12m: number;
  minVolume12mCents: number;
  minPositivePctBps: number;
  minDsrAverageCentis: number;
  minDsrCount: number;
  maxDisputesLostBps: number;
  maxDisputesLostAbsoluteUnder100Sales: number;
  maxSellerCancellationsBps: number;
}

export const DEFAULT_TOP_SELLER_SETTINGS: TopSellerSettings = {
  minAccountAgeDays: 90,
  minSales12m: 20,
  minVolume12mCents: 100_000,
  minPositivePctBps: 9800,
  minDsrAverageCentis: 470,
  minDsrCount: 10,
  maxDisputesLostBps: 100,
  maxDisputesLostAbsoluteUnder100Sales: 1,
  maxSellerCancellationsBps: 200,
};

export interface TopSellerInput {
  accountAgeDays: number;
  transfersEnabled: boolean;
  completedSales12m: number;
  salesVolume12mCents: number;
  sellerPositivePctBps: number | null;
  dsr: ReputationSummary['dsr'];
  disputesLost12m: number;
  sellerCancellations12m: number;
  hasActiveSanction: boolean;
}

export type TopSellerRequirement =
  | 'ACCOUNT_AGE'
  | 'IDENTITY_VERIFIED'
  | 'SALES'
  | 'VOLUME'
  | 'POSITIVE_PCT'
  | 'DSR'
  | 'DISPUTES'
  | 'CANCELLATIONS'
  | 'SANCTIONS';

/** SPEC §8.6. Returns the unmet requirements; empty means "Venditore Top". */
export function unmetTopSellerRequirements(
  i: TopSellerInput,
  s: TopSellerSettings = DEFAULT_TOP_SELLER_SETTINGS,
): TopSellerRequirement[] {
  const unmet: TopSellerRequirement[] = [];
  const dsrCount = DSR_KEYS.reduce((acc, k) => acc + i.dsr[k].count, 0);
  const dsrSum = DSR_KEYS.reduce((acc, k) => acc + i.dsr[k].sum, 0);
  const sales = i.completedSales12m;

  if (i.accountAgeDays < s.minAccountAgeDays) unmet.push('ACCOUNT_AGE');
  if (!i.transfersEnabled) unmet.push('IDENTITY_VERIFIED');
  if (sales < s.minSales12m) unmet.push('SALES');
  if (i.salesVolume12mCents < s.minVolume12mCents) unmet.push('VOLUME');
  if (i.sellerPositivePctBps === null || i.sellerPositivePctBps < s.minPositivePctBps)
    unmet.push('POSITIVE_PCT');
  if (dsrCount < s.minDsrCount || dsrSum * 100 < s.minDsrAverageCentis * dsrCount)
    unmet.push('DSR');
  const disputesOk =
    sales < 100
      ? i.disputesLost12m <= s.maxDisputesLostAbsoluteUnder100Sales
      : i.disputesLost12m * 10_000 <= s.maxDisputesLostBps * sales;
  if (!disputesOk) unmet.push('DISPUTES');
  // ponytail: cancellation rate measured over sales + seller-caused cancellations (see ADR-0012).
  const attempts = sales + i.sellerCancellations12m;
  if (attempts > 0 && i.sellerCancellations12m * 10_000 > s.maxSellerCancellationsBps * attempts)
    unmet.push('CANCELLATIONS');
  if (i.hasActiveSanction) unmet.push('SANCTIONS');
  return unmet;
}

// ───────────────────────── Revisions ─────────────────────────

/** 5 per calendar year plus 5 every 1 000 feedback received in the last 12 months. */
export function revisionRequestQuota(feedbackReceived12m: number): number {
  return 5 + 5 * Math.floor(feedbackReceived12m / 1000);
}

export type RevisionRequestError =
  | 'NOT_NEGATIVE_OR_NEUTRAL'
  | 'TOO_OLD'
  | 'ALREADY_REQUESTED'
  | 'QUOTA_EXCEEDED';

export function revisionRequestErrors(i: {
  rating: FeedbackRating;
  feedbackCreatedAt: Date;
  now: Date;
  alreadyRequestedForOrder: boolean;
  requestsThisYear: number;
  feedbackReceived12m: number;
}): RevisionRequestError[] {
  const errors: RevisionRequestError[] = [];
  if (i.rating === 'POSITIVE') errors.push('NOT_NEGATIVE_OR_NEUTRAL');
  if (i.now.getTime() - i.feedbackCreatedAt.getTime() >= 30 * DAY) errors.push('TOO_OLD');
  if (i.alreadyRequestedForOrder) errors.push('ALREADY_REQUESTED');
  if (i.requestsThisYear >= revisionRequestQuota(i.feedbackReceived12m))
    errors.push('QUOTA_EXCEEDED');
  return errors;
}

export const REVISION_RESPONSE_DAYS = 10;

/** A revision can only improve the rating; the previous values are kept. */
export function applyRevision(
  current: { rating: FeedbackRating; comment: string | null },
  revised: { rating: FeedbackRating; comment: string | null },
): {
  rating: FeedbackRating;
  comment: string | null;
  previousRating: FeedbackRating;
  previousComment: string | null;
} {
  if (RATING_RANK[revised.rating] < RATING_RANK[current.rating]) {
    throw new RangeError('A feedback revision cannot worsen the rating');
  }
  return { ...revised, previousRating: current.rating, previousComment: current.comment };
}

// ───────────────────────── Display helpers ─────────────────────────

/** "mario" → "m***o" (SPEC §8.9). */
export function maskUsername(username: string): string {
  const chars = [...username];
  if (chars.length <= 2) return `${chars[0] ?? ''}***`;
  return `${chars[0]}***${chars[chars.length - 1]}`;
}

export type ResponseTimeBucket = 'WITHIN_HOUR' | 'WITHIN_HOURS' | 'WITHIN_DAY';

/** "Risponde di solito entro un'ora / entro qualche ora / in giornata" (SPEC §8.7). */
export function responseTimeBucket(medianMinutes: number | null): ResponseTimeBucket | null {
  if (medianMinutes === null) return null;
  if (medianMinutes <= 60) return 'WITHIN_HOUR';
  if (medianMinutes <= 6 * 60) return 'WITHIN_HOURS';
  if (medianMinutes <= 24 * 60) return 'WITHIN_DAY';
  return null;
}

// ───────────────────────── Moderation and trust signals ─────────────────────────

export type FeedbackFlag = 'CONTACT_OR_LINKS' | 'PERSONAL_DATA' | 'OFFENSIVE';

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * SPEC §8.8 automatic checks before publication: contacts, links, IBAN and personal data (same
 * detector as the chat) and insults from a configurable list. Any flag → HIDDEN for review.
 */
export function moderateFeedbackText(text: string, insults: readonly string[]): FeedbackFlag[] {
  const flags = new Set<FeedbackFlag>();
  const scan = scanMessage(text);
  if (scan.flags.some((f) => f === 'LINK' || f === 'MESSAGING_APP')) flags.add('CONTACT_OR_LINKS');
  if (scan.flags.some((f) => f === 'PHONE' || f === 'EMAIL' || f === 'IBAN'))
    flags.add('PERSONAL_DATA');
  const words = fold(text);
  if (insults.some((w) => new RegExp(`(^|[^\\p{L}])${fold(w)}([^\\p{L}]|$)`, 'u').test(words)))
    flags.add('OFFENSIVE');
  return [...flags];
}

/**
 * SPEC §8.7: median minutes between a buyer's first message and the seller's first reply, and
 * the share of conversations answered within 24 hours (conversations of the last 30 days).
 */
export function responseMetrics(
  conversations: ReadonlyArray<{ firstBuyerAt: Date; firstReplyAt: Date | null }>,
): { medianMinutes: number | null; responseRateBps: number | null } {
  if (!conversations.length) return { medianMinutes: null, responseRateBps: null };
  const answered = conversations
    .filter((c) => c.firstReplyAt)
    .map((c) => ((c.firstReplyAt as Date).getTime() - c.firstBuyerAt.getTime()) / 60_000)
    .sort((a, b) => a - b);
  const within = answered.filter((m) => m <= 24 * 60).length;
  const mid = answered.length >> 1;
  const median = !answered.length
    ? null
    : Math.round(
        answered.length % 2
          ? (answered[mid] as number)
          : ((answered[mid - 1] as number) + (answered[mid] as number)) / 2,
      );
  return {
    medianMinutes: median,
    responseRateBps: divRoundHalfUp(within * 10_000, conversations.length),
  };
}

/** Pairs ("a|b", sorted ids) with more than 3 orders between them in 30 days (SPEC §8.8). */
export function suspiciousPairs(
  orders: ReadonlyArray<{ buyerId: string; sellerId: string; completedAt: Date }>,
  now: Date,
): Set<string> {
  const since = now.getTime() - 30 * DAY;
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (o.completedAt.getTime() < since) continue;
    const key = [o.buyerId, o.sellerId].sort().join('|');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, n]) => n > 3).map(([k]) => k));
}
