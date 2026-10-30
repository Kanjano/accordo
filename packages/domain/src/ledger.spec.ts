import { describe, expect, it } from 'vitest';
import { computeOrderAmounts, type DeliveryMethod } from './amounts.js';
import {
  accountBalance,
  assertBalanced,
  chargebackLossEntries,
  fullRefundBeforeTransferEntries,
  type LedgerEntryDraft,
  partialRefundEntries,
  paymentSucceededEntries,
  processorFeeEntries,
  sellerChargeEntries,
  transferToSellerEntries,
  UnbalancedLedgerError,
} from './ledger.js';

const settings = {
  buyerFeeBps: 400,
  buyerFeeFixedCents: 50,
  buyerFeeMinCents: 100,
  buyerFeeMaxCents: 2500,
  sellerCommissionBps: 0,
  vatRateBps: 2200,
};
const seller = 'seller-1';

const orderFor = (deliveryMethod: DeliveryMethod, sellerCommissionBps = 0) => ({
  deliveryMethod,
  sellerId: seller,
  ...computeOrderAmounts(
    {
      itemPriceCents: 80_000,
      deliveryMethod,
      integratedShippingCents: 1290,
      selfShippingPriceCents: 900,
    },
    { ...settings, sellerCommissionBps },
  ),
});

describe('ledger', () => {
  it.each(['SHIPPING_INTEGRATED', 'SHIPPING_SELF', 'HAND_DELIVERY'] as const)(
    'payment is balanced (%s)',
    (m) => {
      const tx = paymentSucceededEntries(orderFor(m, 300));
      expect(() => assertBalanced(tx.entries)).not.toThrow();
      expect(tx.entries.every((e) => e.amountCents > 0)).toBe(true);
    },
  );

  it('payment with integrated shipping splits per SPEC §6.9', () => {
    expect(paymentSucceededEntries(orderFor('SHIPPING_INTEGRATED')).entries).toEqual([
      { account: 'CASH_STRIPE', direction: 'DEBIT', amountCents: 83_790 },
      { account: 'SELLER_PAYABLE', direction: 'CREDIT', amountCents: 80_000, userId: seller },
      { account: 'SHIPPING_PAYABLE', direction: 'CREDIT', amountCents: 1290 },
      { account: 'PLATFORM_FEE_REVENUE', direction: 'CREDIT', amountCents: 2049 },
      { account: 'VAT_PAYABLE', direction: 'CREDIT', amountCents: 451 },
    ]);
  });

  it('closed order: seller payable nets to zero after transfer', () => {
    const o = orderFor('SHIPPING_SELF');
    const all: LedgerEntryDraft[] = [
      ...paymentSucceededEntries(o).entries,
      ...processorFeeEntries(250).entries,
      ...transferToSellerEntries(o.sellerNetCents, seller).entries,
    ];
    expect(accountBalance(all, 'SELLER_PAYABLE', seller)).toBe(0);
    expect(accountBalance(all, 'CASH_STRIPE')).toBe(o.totalCents - 250 - o.sellerNetCents);
  });

  it('full refund before transfer reverses every line', () => {
    const o = orderFor('SHIPPING_INTEGRATED');
    const all = [
      ...paymentSucceededEntries(o).entries,
      ...fullRefundBeforeTransferEntries(o).entries,
    ];
    for (const account of [
      'CASH_STRIPE',
      'SELLER_PAYABLE',
      'SHIPPING_PAYABLE',
      'PLATFORM_FEE_REVENUE',
      'VAT_PAYABLE',
    ] as const) {
      expect(accountBalance(all, account)).toBe(0);
    }
  });

  it('partial refund then transfer of the rest closes the seller payable', () => {
    const o = orderFor('SHIPPING_INTEGRATED');
    const all = [
      ...paymentSucceededEntries(o).entries,
      ...partialRefundEntries(15_000, seller).entries,
      ...transferToSellerEntries(o.sellerNetCents - 15_000, seller).entries,
    ];
    expect(accountBalance(all, 'SELLER_PAYABLE', seller)).toBe(0);
  });

  it('seller charges and chargeback losses are balanced', () => {
    expect(sellerChargeEntries(690, seller, 'SHIPPING_PAYABLE').entries[0]).toEqual({
      account: 'SELLER_RECEIVABLE',
      direction: 'DEBIT',
      amountCents: 690,
      userId: seller,
    });
    expect(chargebackLossEntries(5000).entries.map((e) => e.account)).toEqual([
      'CHARGEBACK_LOSSES',
      'CASH_STRIPE',
    ]);
  });

  it('rejects unbalanced, negative or degenerate transactions', () => {
    expect(() =>
      assertBalanced([{ account: 'CASH_STRIPE', direction: 'DEBIT', amountCents: 1 }]),
    ).toThrow(UnbalancedLedgerError);
    expect(() =>
      assertBalanced([
        { account: 'CASH_STRIPE', direction: 'DEBIT', amountCents: 2 },
        { account: 'VAT_PAYABLE', direction: 'CREDIT', amountCents: 1 },
      ]),
    ).toThrow(UnbalancedLedgerError);
    expect(() => transferToSellerEntries(-5, seller)).toThrow(UnbalancedLedgerError);
    expect(() => processorFeeEntries(0)).toThrow(UnbalancedLedgerError);
  });
});
