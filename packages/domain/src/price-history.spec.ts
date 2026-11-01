import { describe, expect, it } from 'vitest';
import { priceReduction } from './price-history.js';

const DAY = 86_400_000;
const now = new Date('2026-11-01T12:00:00Z');
const at = (daysAgo: number, priceCents: number) => ({
  priceCents,
  changedAt: new Date(now.getTime() - daysAgo * DAY),
});

describe('priceReduction', () => {
  it('is null without a cut', () => {
    expect(priceReduction([], now)).toBeNull();
    expect(priceReduction([at(10, 1000)], now)).toBeNull();
    expect(priceReduction([at(10, 1000), at(2, 1200)], now)).toBeNull();
    expect(priceReduction([at(10, 1000), at(2, 1000)], now)).toBeNull();
  });

  it('reports the previous price and the lowest of the 30 days before the cut', () => {
    // 1000 for long, briefly 800 twenty days before the cut, back to 1000, then cut to 900.
    const r = priceReduction([at(5, 900), at(60, 1000), at(25, 800), at(20, 1000)], now);
    expect(r).toEqual({ previousCents: 1000, lowest30dCents: 800, reducedAt: at(5, 0).changedAt });
  });

  it('counts the price in force when the window opens, ignores older ones', () => {
    // 700 ended 40 days before the cut; 1200 was in force when the window opened.
    const r = priceReduction([at(100, 700), at(45, 1200), at(10, 1100), at(1, 1000)], now);
    expect(r?.lowest30dCents).toBe(1100);
    expect(r?.previousCents).toBe(1100);
  });

  it('a listing younger than 30 days uses all its prices', () => {
    expect(priceReduction([at(8, 1500), at(3, 1300)], now)?.lowest30dCents).toBe(1500);
  });

  it('ignores rows that repeat the same price (re-publishing)', () => {
    const r = priceReduction([at(40, 1500), at(10, 1200), at(2, 1200)], now);
    expect(r?.reducedAt).toEqual(at(10, 0).changedAt);
  });

  it('hides the cut after 30 days', () => {
    expect(priceReduction([at(50, 1500), at(31, 1300)], now)).toBeNull();
    expect(priceReduction([at(50, 1500), at(29, 1300)], now)).not.toBeNull();
  });
});
