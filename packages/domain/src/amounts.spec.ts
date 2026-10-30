import { describe, expect, it } from 'vitest';
import { computeOrderAmounts, type FeeSettings } from './amounts.js';
import { applyBps, divRoundHalfUp } from './money.js';

const settings: FeeSettings = {
  buyerFeeBps: 400,
  buyerFeeFixedCents: 50,
  buyerFeeMinCents: 100,
  buyerFeeMaxCents: 2500,
  sellerCommissionBps: 0,
  vatRateBps: 2200,
};

describe('computeOrderAmounts — SPEC §6.3 examples', () => {
  it.each([
    {
      name: 'guitar, integrated shipping L: fee capped at 25,00 €',
      input: {
        itemPriceCents: 80_000,
        deliveryMethod: 'SHIPPING_INTEGRATED',
        integratedShippingCents: 1290,
      },
      expected: {
        shippingPriceCents: 1290,
        buyerFeeCents: 2500,
        buyerFeeVatCents: 451,
        totalCents: 83_790,
        sellerNetCents: 80_000,
      },
    },
    {
      name: 'pedal, hand delivery: 4% + 0,50',
      input: { itemPriceCents: 12_000, deliveryMethod: 'HAND_DELIVERY' },
      expected: {
        shippingPriceCents: 0,
        buyerFeeCents: 530,
        totalCents: 12_530,
        sellerNetCents: 12_000,
      },
    },
    {
      name: 'picks, self shipping: fee raised to the 1,00 € minimum, seller gets shipping',
      input: { itemPriceCents: 400, deliveryMethod: 'SHIPPING_SELF', selfShippingPriceCents: 250 },
      expected: {
        shippingPriceCents: 250,
        buyerFeeCents: 100,
        totalCents: 750,
        sellerNetCents: 650,
      },
    },
  ] as const)('$name', ({ input, expected }) => {
    expect(computeOrderAmounts(input, settings)).toMatchObject(expected);
  });
});

describe('computeOrderAmounts — rules', () => {
  it('rounds half-up on the percentage', () => {
    // 4% of 1 237 = 49.48 → 49; 4% of 1 238 = 49.52 → 50 (then +50 fixed)
    expect(
      computeOrderAmounts({ itemPriceCents: 1237, deliveryMethod: 'HAND_DELIVERY' }, settings)
        .buyerFeeCents,
    ).toBe(100);
    expect(
      computeOrderAmounts({ itemPriceCents: 2_500, deliveryMethod: 'HAND_DELIVERY' }, settings)
        .buyerFeeCents,
    ).toBe(150);
    expect(
      computeOrderAmounts(
        { itemPriceCents: 1_313, deliveryMethod: 'HAND_DELIVERY' },
        { ...settings, buyerFeeMinCents: 0 },
      ).buyerFeeCents,
    ).toBe(103);
  });

  it('applies seller commission and keeps total = item + shipping + fee', () => {
    const a = computeOrderAmounts(
      { itemPriceCents: 10_000, deliveryMethod: 'SHIPPING_SELF', selfShippingPriceCents: 700 },
      { ...settings, sellerCommissionBps: 500 },
    );
    expect(a.sellerFeeCents).toBe(500);
    expect(a.sellerNetCents).toBe(10_000 - 500 + 700);
    expect(a.totalCents).toBe(a.itemPriceCents + a.shippingPriceCents + a.buyerFeeCents);
  });

  it('integrated shipping is not paid to the seller', () => {
    const a = computeOrderAmounts(
      { itemPriceCents: 5000, deliveryMethod: 'SHIPPING_INTEGRATED', integratedShippingCents: 590 },
      settings,
    );
    expect(a.sellerNetCents).toBe(5000);
  });

  it('rejects invalid input', () => {
    expect(() =>
      computeOrderAmounts({ itemPriceCents: 0, deliveryMethod: 'HAND_DELIVERY' }, settings),
    ).toThrow();
    expect(() =>
      computeOrderAmounts({ itemPriceCents: 10.5, deliveryMethod: 'HAND_DELIVERY' }, settings),
    ).toThrow();
    expect(() =>
      computeOrderAmounts({ itemPriceCents: 100, deliveryMethod: 'SHIPPING_INTEGRATED' }, settings),
    ).toThrow(/integratedShippingCents/);
    expect(() =>
      computeOrderAmounts({ itemPriceCents: 100, deliveryMethod: 'SHIPPING_SELF' }, settings),
    ).toThrow(/selfShippingPriceCents/);
    expect(() =>
      computeOrderAmounts(
        { itemPriceCents: 100, deliveryMethod: 'SHIPPING_SELF', selfShippingPriceCents: -1 },
        settings,
      ),
    ).toThrow();
  });
});

describe('money helpers', () => {
  it('divRoundHalfUp', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 3)).toBe(1);
    expect(divRoundHalfUp(0, 7)).toBe(0);
    expect(applyBps(12_345, 400)).toBe(494);
    expect(() => divRoundHalfUp(1, 0)).toThrow();
    expect(() => divRoundHalfUp(-1, 2)).toThrow();
    expect(() => divRoundHalfUp(1.5, 2)).toThrow();
  });
});
