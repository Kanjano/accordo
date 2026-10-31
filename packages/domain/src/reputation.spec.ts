import { describe, expect, it } from 'vitest';
import {
  applyRevision,
  canLeaveFeedback,
  computeReputation,
  countableFeedbackIds,
  type FeedbackRecord,
  formatPositivePct,
  levelFor,
  maskUsername,
  moderateFeedbackText,
  responseMetrics,
  responseTimeBucket,
  revisionRequestErrors,
  revisionRequestQuota,
  suspiciousPairs,
  type TopSellerInput,
  unmetTopSellerRequirements,
  validateFeedbackInput,
  weekKey,
} from './reputation.js';

const now = new Date('2026-10-30T12:00:00Z');
const DAY = 86_400_000;
let seq = 0;
const fb = (over: Partial<FeedbackRecord> = {}): FeedbackRecord => ({
  id: `f${String(++seq).padStart(4, '0')}`,
  authorId: `buyer${seq}`,
  recipientId: 'seller',
  role: 'BUYER_TO_SELLER',
  rating: 'POSITIVE',
  status: 'PUBLISHED',
  orderItemPriceCents: 10_000,
  weekKey: `2026-W${String((seq % 40) + 1).padStart(2, '0')}`,
  createdAt: new Date(now.getTime() - 10 * DAY),
  dsrItemAsDescribed: 5,
  dsrCommunication: 5,
  dsrShippingTime: 4,
  dsrPackaging: 5,
  ...over,
});

describe('weekKey', () => {
  it('uses the ISO week on the Rome calendar', () => {
    expect(weekKey(new Date('2026-10-30T12:00:00Z'))).toBe('2026-W44');
    expect(weekKey(new Date('2027-01-01T10:00:00Z'))).toBe('2026-W53');
    expect(weekKey(new Date('2026-01-04T23:30:00Z'))).toBe('2026-W02'); // already Monday in Rome
  });
});

describe('canLeaveFeedback', () => {
  it('only on COMPLETED orders within 60 days', () => {
    expect(
      canLeaveFeedback(
        { status: 'COMPLETED', completedAt: new Date(now.getTime() - 60 * DAY) },
        now,
      ),
    ).toEqual({ ok: true });
    expect(
      canLeaveFeedback(
        { status: 'COMPLETED', completedAt: new Date(now.getTime() - 61 * DAY) },
        now,
      ),
    ).toEqual({ ok: false, reason: 'WINDOW_CLOSED' });
    expect(canLeaveFeedback({ status: 'DELIVERED', completedAt: null }, now)).toEqual({
      ok: false,
      reason: 'ORDER_NOT_COMPLETED',
    });
    expect(canLeaveFeedback({ status: 'COMPLETED', completedAt: null }, now)).toEqual({
      ok: false,
      reason: 'ORDER_NOT_COMPLETED',
    });
  });
});

describe('validateFeedbackInput', () => {
  const full = { itemAsDescribed: 5, communication: 5, shippingTime: 5, packaging: 5 };
  it('seller can only leave positive feedback without ratings', () => {
    expect(
      validateFeedbackInput({
        role: 'SELLER_TO_BUYER',
        rating: 'NEGATIVE',
        deliveryMethod: 'SHIPPING_SELF',
      }),
    ).toEqual(['SELLER_ONLY_POSITIVE']);
    expect(
      validateFeedbackInput({
        role: 'SELLER_TO_BUYER',
        rating: 'POSITIVE',
        deliveryMethod: 'SHIPPING_SELF',
        dsr: full,
        comment: 'x'.repeat(501),
      }),
    ).toEqual(['COMMENT_LENGTH', 'DSR_NOT_ALLOWED']);
    expect(
      validateFeedbackInput({
        role: 'SELLER_TO_BUYER',
        rating: 'POSITIVE',
        deliveryMethod: 'SHIPPING_SELF',
      }),
    ).toEqual([]);
  });
  it('neutral/negative need a 20–500 character comment', () => {
    const base = {
      role: 'BUYER_TO_SELLER',
      rating: 'NEGATIVE',
      deliveryMethod: 'SHIPPING_SELF',
      dsr: full,
    } as const;
    expect(validateFeedbackInput(base)).toEqual(['COMMENT_REQUIRED']);
    expect(validateFeedbackInput({ ...base, comment: 'troppo corto' })).toEqual(['COMMENT_LENGTH']);
    expect(
      validateFeedbackInput({ ...base, comment: 'Oggetto diverso dalla descrizione.' }),
    ).toEqual([]);
    expect(
      validateFeedbackInput({ ...base, rating: 'POSITIVE', comment: 'x'.repeat(501) }),
    ).toEqual(['COMMENT_LENGTH']);
  });
  it('detailed ratings: all four for shipping, no shipping/packaging for hand delivery', () => {
    expect(
      validateFeedbackInput({
        role: 'BUYER_TO_SELLER',
        rating: 'POSITIVE',
        deliveryMethod: 'SHIPPING_INTEGRATED',
        dsr: { itemAsDescribed: 5, communication: 5 },
      }),
    ).toEqual(['DSR_REQUIRED']);
    expect(
      validateFeedbackInput({
        role: 'BUYER_TO_SELLER',
        rating: 'POSITIVE',
        deliveryMethod: 'HAND_DELIVERY',
        dsr: { itemAsDescribed: 5, communication: 4 },
      }),
    ).toEqual([]);
    expect(
      validateFeedbackInput({
        role: 'BUYER_TO_SELLER',
        rating: 'POSITIVE',
        deliveryMethod: 'HAND_DELIVERY',
        dsr: full,
      }),
    ).toEqual(['DSR_NOT_ALLOWED']);
    expect(
      validateFeedbackInput({
        role: 'BUYER_TO_SELLER',
        rating: 'POSITIVE',
        deliveryMethod: 'SHIPPING_SELF',
        dsr: { ...full, packaging: 6 },
      }),
    ).toEqual(['DSR_RANGE']);
    expect(
      validateFeedbackInput({
        role: 'BUYER_TO_SELLER',
        rating: 'POSITIVE',
        deliveryMethod: 'HAND_DELIVERY',
      }),
    ).toEqual(['DSR_REQUIRED']);
  });
});

describe('countableFeedbackIds', () => {
  it('dedupes per author/recipient/role/week and applies the minimum amount', () => {
    const a = fb({ authorId: 'x', weekKey: '2026-W40', createdAt: new Date('2026-10-01') });
    const b = fb({ authorId: 'x', weekKey: '2026-W40', createdAt: new Date('2026-10-02') });
    const c = fb({ authorId: 'x', weekKey: '2026-W41' });
    const cheap = fb({ orderItemPriceCents: 299 });
    const hidden = fb({ status: 'HIDDEN' });
    expect(countableFeedbackIds([b, a, c, cheap, hidden])).toEqual(new Set([a.id, c.id]));
  });
  it('a removed first feedback lets the next one in the group count', () => {
    const a = fb({
      authorId: 'y',
      weekKey: '2026-W40',
      status: 'REMOVED',
      createdAt: new Date('2026-10-01'),
    });
    const b = fb({ authorId: 'y', weekKey: '2026-W40', createdAt: new Date('2026-10-02') });
    expect(countableFeedbackIds([a, b])).toEqual(new Set([b.id]));
  });
  it('ties on createdAt are broken by id', () => {
    const t = new Date('2026-10-01');
    const a = fb({ id: 'a', authorId: 'z', weekKey: 'W', createdAt: t });
    const b = fb({ id: 'b', authorId: 'z', weekKey: 'W', createdAt: t });
    expect(countableFeedbackIds([b, a])).toEqual(new Set(['a']));
  });
});

describe('computeReputation', () => {
  it('score, 12-month percentage without neutrals, buyer positives, DSR averages', () => {
    const received = [
      ...Array.from({ length: 8 }, () => fb()),
      fb({ rating: 'NEUTRAL' }),
      fb({ rating: 'NEGATIVE', dsrItemAsDescribed: 1 }),
      fb({ createdAt: new Date(now.getTime() - 400 * DAY) }), // counts for score only
      fb({
        role: 'SELLER_TO_BUYER',
        dsrItemAsDescribed: null,
        dsrCommunication: null,
        dsrShippingTime: null,
        dsrPackaging: null,
      }),
      fb({ status: 'REMOVED', rating: 'NEGATIVE' }),
    ];
    const r = computeReputation(received, now);
    expect(r.score).toBe(8 - 1 + 1 + 1);
    expect([r.sellerPositive12m, r.sellerNeutral12m, r.sellerNegative12m]).toEqual([8, 1, 1]);
    expect(r.sellerPositivePctBps).toBe(8889);
    expect(r.buyerPositive12m).toBe(1);
    expect(r.dsr.ItemAsDescribed).toEqual({ avg: 4.6, count: 10, sum: 46 });
    expect(r.dsr.ShippingTime.avg).toBe(4);
    expect(r.levelKey).toBeNull();
  });

  it('no feedback → no percentage', () => {
    const r = computeReputation([], now);
    expect(r.sellerPositivePctBps).toBeNull();
    expect(r.dsr.Packaging).toEqual({ avg: null, count: 0, sum: 0 });
  });

  it('hand-delivery feedback has no shipping/packaging ratings', () => {
    const r = computeReputation([fb({ dsrShippingTime: null, dsrPackaging: null })], now);
    expect(r.dsr.ShippingTime.count).toBe(0);
    expect(r.dsr.Communication.count).toBe(1);
  });

  it('formats the percentage with one decimal', () => {
    expect(formatPositivePct(9940)).toBe('99,4%');
    expect(formatPositivePct(10_000)).toBe('100,0%');
    expect(formatPositivePct(null)).toBeNull();
  });
});

describe('levels', () => {
  it.each([
    [9, null],
    [10, 'NEWCOMER'],
    [49, 'NEWCOMER'],
    [50, 'SESSION_PLAYER'],
    [100, 'SOLOIST'],
    [500, 'PROFESSIONAL'],
    [999, 'PROFESSIONAL'],
    [1000, 'MAESTRO'],
    [5000, 'LEGEND'],
  ])('%i → %s', (score, level) => expect(levelFor(score)).toBe(level));
});

describe('Top Seller', () => {
  const dsr = (avg: number, count: number) => ({ avg, count, sum: avg * count });
  const ok: TopSellerInput = {
    accountAgeDays: 120,
    transfersEnabled: true,
    completedSales12m: 25,
    salesVolume12mCents: 150_000,
    sellerPositivePctBps: 9900,
    dsr: {
      ItemAsDescribed: dsr(5, 5),
      Communication: dsr(5, 5),
      ShippingTime: dsr(4, 0),
      Packaging: dsr(4, 0),
    },
    disputesLost12m: 1,
    sellerCancellations12m: 0,
    hasActiveSanction: false,
  };

  it('eligible seller', () => expect(unmetTopSellerRequirements(ok)).toEqual([]));

  it('reports every unmet requirement', () => {
    expect(
      unmetTopSellerRequirements({
        accountAgeDays: 10,
        transfersEnabled: false,
        completedSales12m: 19,
        salesVolume12mCents: 99_999,
        sellerPositivePctBps: null,
        dsr: {
          ItemAsDescribed: dsr(5, 3),
          Communication: dsr(5, 3),
          ShippingTime: dsr(5, 3),
          Packaging: dsr(5, 0),
        },
        disputesLost12m: 2,
        sellerCancellations12m: 1,
        hasActiveSanction: true,
      }),
    ).toEqual([
      'ACCOUNT_AGE',
      'IDENTITY_VERIFIED',
      'SALES',
      'VOLUME',
      'POSITIVE_PCT',
      'DSR',
      'DISPUTES',
      'CANCELLATIONS',
      'SANCTIONS',
    ]);
  });

  it('thresholds', () => {
    expect(unmetTopSellerRequirements({ ...ok, sellerPositivePctBps: 9799 })).toEqual([
      'POSITIVE_PCT',
    ]);
    expect(
      unmetTopSellerRequirements({
        ...ok,
        dsr: { ...ok.dsr, ItemAsDescribed: dsr(4, 5), Communication: dsr(5, 5) },
      }),
    ).toEqual(['DSR']);
    // 200 sales: 2 disputes lost = 1% ok, 3 not
    expect(
      unmetTopSellerRequirements({ ...ok, completedSales12m: 200, disputesLost12m: 2 }),
    ).toEqual([]);
    expect(
      unmetTopSellerRequirements({ ...ok, completedSales12m: 200, disputesLost12m: 3 }),
    ).toEqual(['DISPUTES']);
    // 98 sales + 2 cancellations = 2% ok; 3 not
    expect(
      unmetTopSellerRequirements({ ...ok, completedSales12m: 98, sellerCancellations12m: 2 }),
    ).toEqual([]);
    expect(
      unmetTopSellerRequirements({ ...ok, completedSales12m: 98, sellerCancellations12m: 3 }),
    ).toEqual(['CANCELLATIONS']);
  });
});

describe('revision requests', () => {
  it('quota: 5 per year plus 5 every 1 000 feedback', () => {
    expect(revisionRequestQuota(0)).toBe(5);
    expect(revisionRequestQuota(999)).toBe(5);
    expect(revisionRequestQuota(2500)).toBe(15);
  });

  it('rules', () => {
    const base = {
      rating: 'NEGATIVE' as const,
      feedbackCreatedAt: new Date(now.getTime() - 29 * DAY),
      now,
      alreadyRequestedForOrder: false,
      requestsThisYear: 4,
      feedbackReceived12m: 10,
    };
    expect(revisionRequestErrors(base)).toEqual([]);
    expect(
      revisionRequestErrors({
        ...base,
        rating: 'POSITIVE',
        feedbackCreatedAt: new Date(now.getTime() - 30 * DAY),
        alreadyRequestedForOrder: true,
        requestsThisYear: 5,
      }),
    ).toEqual(['NOT_NEGATIVE_OR_NEUTRAL', 'TOO_OLD', 'ALREADY_REQUESTED', 'QUOTA_EXCEEDED']);
  });

  it('a revision can only improve and keeps the previous values', () => {
    expect(
      applyRevision(
        { rating: 'NEGATIVE', comment: 'male' },
        { rating: 'POSITIVE', comment: 'risolto' },
      ),
    ).toEqual({
      rating: 'POSITIVE',
      comment: 'risolto',
      previousRating: 'NEGATIVE',
      previousComment: 'male',
    });
    expect(() =>
      applyRevision({ rating: 'NEUTRAL', comment: null }, { rating: 'NEGATIVE', comment: null }),
    ).toThrow();
  });
});

describe('display helpers', () => {
  it('maskUsername', () => {
    expect(maskUsername('mario')).toBe('m***o');
    expect(maskUsername('al')).toBe('a***');
    expect(maskUsername('')).toBe('***');
  });
  it('responseTimeBucket', () => {
    expect(responseTimeBucket(null)).toBeNull();
    expect(responseTimeBucket(45)).toBe('WITHIN_HOUR');
    expect(responseTimeBucket(200)).toBe('WITHIN_HOURS');
    expect(responseTimeBucket(1000)).toBe('WITHIN_DAY');
    expect(responseTimeBucket(2000)).toBeNull();
  });
});

describe('moderation and trust signals', () => {
  it('hides feedback with contacts, links, personal data or insults', () => {
    expect(moderateFeedbackText('Tutto perfetto, consigliato!', ['idiota'])).toEqual([]);
    expect(moderateFeedbackText('Scrivimi su whatsapp 333 123 4567', [])).toEqual(
      expect.arrayContaining(['CONTACT_OR_LINKS', 'PERSONAL_DATA']),
    );
    expect(moderateFeedbackText('Venditore IDIOTA, mai più', ['idiota'])).toEqual(['OFFENSIVE']);
    expect(moderateFeedbackText('Idiotamente bravo', ['idiota'])).toEqual([]); // whole words only
  });

  it('computes median response time and response rate within 24 hours', () => {
    const t = (min: number) => new Date(Date.UTC(2026, 0, 1) + min * 60_000);
    expect(responseMetrics([])).toEqual({ medianMinutes: null, responseRateBps: null });
    expect(
      responseMetrics([
        { firstBuyerAt: t(0), firstReplyAt: t(10) },
        { firstBuyerAt: t(0), firstReplyAt: t(30) },
        { firstBuyerAt: t(0), firstReplyAt: t(3000) },
        { firstBuyerAt: t(0), firstReplyAt: null },
      ]),
    ).toEqual({ medianMinutes: 30, responseRateBps: 5000 });
    expect(
      responseMetrics([
        { firstBuyerAt: t(0), firstReplyAt: t(20) },
        { firstBuyerAt: t(0), firstReplyAt: t(40) },
      ]).medianMinutes,
    ).toBe(30);
  });

  it('flags pairs with more than 3 orders between them in 30 days', () => {
    const now = new Date('2026-11-30T00:00:00Z');
    const day = (d: number) => new Date(now.getTime() - d * 86_400_000);
    const orders = [
      { buyerId: 'a', sellerId: 'b', completedAt: day(1) },
      { buyerId: 'b', sellerId: 'a', completedAt: day(2) },
      { buyerId: 'a', sellerId: 'b', completedAt: day(3) },
      { buyerId: 'a', sellerId: 'b', completedAt: day(4) },
      { buyerId: 'c', sellerId: 'b', completedAt: day(1) },
      { buyerId: 'a', sellerId: 'c', completedAt: day(40) },
    ];
    expect(suspiciousPairs(orders, now)).toEqual(new Set(['a|b']));
  });
});
