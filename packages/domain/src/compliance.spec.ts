import { describe, expect, it } from 'vitest';
import { dac7Assessment, sameShape, yearQuarter } from './compliance.js';
import { isIban } from './scan-message.js';

describe('sameShape', () => {
  const fees = { buyerFeeBps: 400, flags: { a: true }, terms: ['avorio'], sizes: [{ kg: 2 }] };
  it('accepts new values with the same structure', () => {
    expect(sameShape(fees, { buyerFeeBps: 500, flags: { a: false }, terms: [], sizes: [] })).toBe(
      true,
    );
    expect(sameShape([], ['a', 'b'])).toBe(true);
    expect(sameShape({}, {})).toBe(true);
  });
  it('rejects missing, extra or retyped keys', () => {
    expect(sameShape(fees, { ...fees, buyerFeeBps: '500' })).toBe(false);
    expect(sameShape(fees, { ...fees, extra: 1 })).toBe(false);
    const { flags: _, ...missing } = fees;
    expect(sameShape(fees, missing)).toBe(false);
    expect(sameShape(fees, { ...fees, terms: [1] })).toBe(false);
    expect(sameShape(fees, { ...fees, sizes: [{ kg: '2' }] })).toBe(false);
    expect(sameShape([], [{ a: 1 }])).toBe(false);
    expect(sameShape(null, {})).toBe(false);
  });
});

describe('dac7Assessment', () => {
  const s = {
    minActivities: 30,
    maxConsiderationCents: 200_000,
    requestAtBps: 8000,
    reminderEveryDays: 7,
    maxReminders: 3,
    blockPayoutsWithoutProfile: false,
  };
  it('is reportable from 30 sales or above 2,000 €, either one', () => {
    expect(dac7Assessment({ activities: 30, considerationCents: 1000 }, s).reportable).toBe(true);
    expect(dac7Assessment({ activities: 2, considerationCents: 200_001 }, s).reportable).toBe(true);
    expect(dac7Assessment({ activities: 29, considerationCents: 200_000 }, s)).toEqual({
      reportable: false,
      requestProfile: true,
    });
  });
  it('asks for the tax profile at 80% of a threshold', () => {
    expect(dac7Assessment({ activities: 24, considerationCents: 0 }, s).requestProfile).toBe(true);
    expect(dac7Assessment({ activities: 23, considerationCents: 159_999 }, s)).toEqual({
      reportable: false,
      requestProfile: false,
    });
    expect(dac7Assessment({ activities: 0, considerationCents: 160_000 }, s).requestProfile).toBe(
      true,
    );
  });
});

describe('yearQuarter', () => {
  it('uses Italian time', () => {
    expect(yearQuarter(new Date('2026-03-31T22:30:00Z'))).toEqual({ year: 2026, quarter: 2 });
    expect(yearQuarter(new Date('2026-12-31T23:30:00Z'))).toEqual({ year: 2027, quarter: 1 });
    expect(yearQuarter(new Date('2026-07-01T00:00:00Z'))).toEqual({ year: 2026, quarter: 3 });
  });
});

describe('isIban', () => {
  it('checks the mod-97 checksum', () => {
    expect(isIban('IT60 X054 2811 1010 0000 0123 456')).toBe(true);
    expect(isIban('IT61X0542811101000000123456')).toBe(false);
  });
});
