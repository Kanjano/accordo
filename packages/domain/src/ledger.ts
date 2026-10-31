import type { DeliveryMethod, OrderAmounts } from './amounts.js';

export type LedgerAccount =
  | 'CASH_STRIPE'
  | 'SELLER_PAYABLE'
  | 'SHIPPING_PAYABLE'
  | 'PLATFORM_FEE_REVENUE'
  | 'VAT_PAYABLE'
  | 'PAYMENT_PROCESSOR_FEES'
  | 'CHARGEBACK_LOSSES'
  | 'SELLER_RECEIVABLE';

export interface LedgerEntryDraft {
  account: LedgerAccount;
  direction: 'DEBIT' | 'CREDIT';
  amountCents: number;
  /** Set on seller sub-ledger entries (SELLER_PAYABLE, SELLER_RECEIVABLE). */
  userId?: string;
}

export interface LedgerTransactionDraft {
  type: string;
  entries: LedgerEntryDraft[];
}

export class UnbalancedLedgerError extends Error {}

const debit = (account: LedgerAccount, amountCents: number, userId?: string): LedgerEntryDraft => ({
  account,
  direction: 'DEBIT',
  amountCents,
  ...(userId ? { userId } : {}),
});
const credit = (
  account: LedgerAccount,
  amountCents: number,
  userId?: string,
): LedgerEntryDraft => ({
  account,
  direction: 'CREDIT',
  amountCents,
  ...(userId ? { userId } : {}),
});

/** Drops zero lines (DB: amountCents > 0), rejects negatives, enforces Σ DEBIT = Σ CREDIT. */
function finalize(type: string, entries: LedgerEntryDraft[]): LedgerTransactionDraft {
  const kept = entries.filter((e) => e.amountCents !== 0);
  for (const e of kept) {
    if (!Number.isSafeInteger(e.amountCents) || e.amountCents < 0) {
      throw new UnbalancedLedgerError(`${type}: invalid amount ${e.amountCents} on ${e.account}`);
    }
  }
  assertBalanced(kept, type);
  return { type, entries: kept };
}

export function assertBalanced(entries: readonly LedgerEntryDraft[], label = 'ledger'): void {
  const sum = (dir: 'DEBIT' | 'CREDIT') =>
    entries.filter((e) => e.direction === dir).reduce((acc, e) => acc + e.amountCents, 0);
  if (entries.length < 2 || sum('DEBIT') !== sum('CREDIT')) {
    throw new UnbalancedLedgerError(`${label}: debits ${sum('DEBIT')} ≠ credits ${sum('CREDIT')}`);
  }
}

/** Signed balance of an account (debits positive) over a set of entries. */
export function accountBalance(
  entries: readonly LedgerEntryDraft[],
  account: LedgerAccount,
  userId?: string,
): number {
  return entries
    .filter((e) => e.account === account && (userId === undefined || e.userId === userId))
    .reduce((acc, e) => acc + (e.direction === 'DEBIT' ? e.amountCents : -e.amountCents), 0);
}

type PaymentInput = Pick<
  OrderAmounts,
  | 'totalCents'
  | 'sellerNetCents'
  | 'shippingPriceCents'
  | 'buyerFeeCents'
  | 'buyerFeeVatCents'
  | 'sellerFeeCents'
> & { deliveryMethod: DeliveryMethod; sellerId: string };

function paymentLines(o: PaymentInput): LedgerEntryDraft[] {
  const integratedShipping = o.deliveryMethod === 'SHIPPING_INTEGRATED' ? o.shippingPriceCents : 0;
  return [
    debit('CASH_STRIPE', o.totalCents),
    credit('SELLER_PAYABLE', o.sellerNetCents, o.sellerId),
    credit('SHIPPING_PAYABLE', integratedShipping),
    credit('PLATFORM_FEE_REVENUE', o.buyerFeeCents - o.buyerFeeVatCents + o.sellerFeeCents),
    credit('VAT_PAYABLE', o.buyerFeeVatCents),
  ];
}

/** SPEC §6.9 — payment succeeded. */
export function paymentSucceededEntries(o: PaymentInput): LedgerTransactionDraft {
  return finalize('PAYMENT_SUCCEEDED', paymentLines(o));
}

/** Stripe fees read from the balance transaction (borne by the platform). */
export function processorFeeEntries(feeCents: number): LedgerTransactionDraft {
  return finalize('PROCESSOR_FEE', [
    debit('PAYMENT_PROCESSOR_FEES', feeCents),
    credit('CASH_STRIPE', feeCents),
  ]);
}

export function transferToSellerEntries(
  amountCents: number,
  sellerId: string,
): LedgerTransactionDraft {
  return finalize('TRANSFER_TO_SELLER', [
    debit('SELLER_PAYABLE', amountCents, sellerId),
    credit('CASH_STRIPE', amountCents),
  ]);
}

/** Full refund before the transfer: mirror of the payment lines. */
export function fullRefundBeforeTransferEntries(o: PaymentInput): LedgerTransactionDraft {
  return finalize(
    'REFUND_FULL',
    paymentLines(o).map((e) => ({ ...e, direction: e.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT' })),
  );
}

/** Partial refund on the item price only: reduces what the seller is owed. */
export function partialRefundEntries(
  amountCents: number,
  sellerId: string,
): LedgerTransactionDraft {
  return finalize('REFUND_PARTIAL', [
    debit('SELLER_PAYABLE', amountCents, sellerId),
    credit('CASH_STRIPE', amountCents),
  ]);
}

/** Charge to the seller (labels, returns, refunds after transfer): receivable against a cost/revenue account. */
export function sellerChargeEntries(
  amountCents: number,
  sellerId: string,
  against: Exclude<LedgerAccount, 'SELLER_RECEIVABLE'>,
): LedgerTransactionDraft {
  return finalize('SELLER_CHARGE', [
    debit('SELLER_RECEIVABLE', amountCents, sellerId),
    credit(against, amountCents),
  ]);
}

export function chargebackLossEntries(amountCents: number): LedgerTransactionDraft {
  return finalize('CHARGEBACK_LOST', [
    debit('CHARGEBACK_LOSSES', amountCents),
    credit('CASH_STRIPE', amountCents),
  ]);
}

/** Refund after the transfer (SPEC §6.7): the buyer is refunded, the seller now owes the amount. */
export function refundAfterTransferEntries(
  amountCents: number,
  sellerId: string,
): LedgerTransactionDraft {
  return finalize('REFUND_AFTER_TRANSFER', [
    debit('SELLER_RECEIVABLE', amountCents, sellerId),
    credit('CASH_STRIPE', amountCents),
  ]);
}

/** Transfer reversal: money back from the seller's account settles the receivable. */
export function transferReversalEntries(
  amountCents: number,
  sellerId: string,
): LedgerTransactionDraft {
  return finalize('TRANSFER_REVERSAL', [
    debit('CASH_STRIPE', amountCents),
    credit('SELLER_RECEIVABLE', amountCents, sellerId),
  ]);
}

/** Transfer net of what the seller owes: the offset settles the receivable (SPEC §6.7). */
export function transferWithOffsetEntries(
  payableCents: number,
  offsetCents: number,
  sellerId: string,
): LedgerTransactionDraft {
  if (offsetCents > payableCents) throw new UnbalancedLedgerError('offset exceeds payable');
  return finalize('TRANSFER_TO_SELLER', [
    debit('SELLER_PAYABLE', payableCents, sellerId),
    credit('CASH_STRIPE', payableCents - offsetCents),
    credit('SELLER_RECEIVABLE', offsetCents, sellerId),
  ]);
}

/** Chargeback lost by a seller without protection, before the transfer: the payable is cancelled. */
export function chargebackSellerLiableEntries(
  amountCents: number,
  payableCents: number,
  sellerId: string,
): LedgerTransactionDraft {
  const fromSeller = Math.min(amountCents, payableCents);
  return finalize('CHARGEBACK_LOST', [
    debit('SELLER_PAYABLE', fromSeller, sellerId),
    debit('CHARGEBACK_LOSSES', amountCents - fromSeller),
    credit('CASH_STRIPE', amountCents),
  ]);
}
