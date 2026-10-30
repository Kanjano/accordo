import { applyBps, assertCents, divRoundHalfUp } from './money.js';

export type DeliveryMethod = 'SHIPPING_INTEGRATED' | 'SHIPPING_SELF' | 'HAND_DELIVERY';

export interface FeeSettings {
  buyerFeeBps: number;
  buyerFeeFixedCents: number;
  buyerFeeMinCents: number;
  buyerFeeMaxCents: number;
  sellerCommissionBps: number;
  vatRateBps: number;
}

export interface OrderAmountsInput {
  itemPriceCents: number;
  deliveryMethod: DeliveryMethod;
  /** Parcel size price (§7.1); required for SHIPPING_INTEGRATED. */
  integratedShippingCents?: number | null;
  /** listing.selfShippingPriceCents; required for SHIPPING_SELF. */
  selfShippingPriceCents?: number | null;
}

export interface OrderAmounts {
  itemPriceCents: number;
  shippingPriceCents: number;
  buyerFeeCents: number;
  buyerFeeVatCents: number;
  sellerFeeCents: number;
  totalCents: number;
  sellerNetCents: number;
}

/** SPEC §6.3. All amounts in integer cents, half-up rounding, percentages in basis points. */
export function computeOrderAmounts(input: OrderAmountsInput, s: FeeSettings): OrderAmounts {
  const { itemPriceCents, deliveryMethod } = input;
  assertCents(itemPriceCents, 'itemPriceCents');
  if (itemPriceCents === 0) throw new RangeError('itemPriceCents must be positive');

  const shippingPriceCents = shippingFor(input);
  const rawFee = applyBps(itemPriceCents, s.buyerFeeBps) + s.buyerFeeFixedCents;
  const buyerFeeCents = Math.min(Math.max(rawFee, s.buyerFeeMinCents), s.buyerFeeMaxCents);
  const buyerFeeVatCents = divRoundHalfUp(buyerFeeCents * s.vatRateBps, 10_000 + s.vatRateBps);
  const sellerFeeCents = applyBps(itemPriceCents, s.sellerCommissionBps);
  const sellerNetCents =
    itemPriceCents - sellerFeeCents + (deliveryMethod === 'SHIPPING_SELF' ? shippingPriceCents : 0);

  return {
    itemPriceCents,
    shippingPriceCents,
    buyerFeeCents,
    buyerFeeVatCents,
    sellerFeeCents,
    totalCents: itemPriceCents + shippingPriceCents + buyerFeeCents,
    sellerNetCents,
  };
}

function shippingFor(input: OrderAmountsInput): number {
  switch (input.deliveryMethod) {
    case 'HAND_DELIVERY':
      return 0;
    case 'SHIPPING_INTEGRATED':
      return required(input.integratedShippingCents, 'integratedShippingCents');
    case 'SHIPPING_SELF':
      return required(input.selfShippingPriceCents, 'selfShippingPriceCents');
  }
}

function required(value: number | null | undefined, name: string): number {
  if (value == null) throw new RangeError(`${name} is required for this delivery method`);
  assertCents(value, name);
  return value;
}
