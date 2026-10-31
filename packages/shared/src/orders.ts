import { z } from 'zod';
import type { ItemCondition } from './listings.js';

export const DELIVERY_METHODS = ['SHIPPING_INTEGRATED', 'SHIPPING_SELF', 'HAND_DELIVERY'] as const;
export type DeliveryMethodCode = (typeof DELIVERY_METHODS)[number];

/** Tracked services accepted for self shipping (SPEC §6.5: untracked shipping is not allowed). */
export const CARRIERS = [
  'POSTE',
  'BRT',
  'GLS',
  'SDA',
  'DHL',
  'UPS',
  'FEDEX',
  'TNT',
  'INPOST',
] as const;

export const orderCreateSchema = z.object({
  listingId: z.uuid(),
  deliveryMethod: z.enum(DELIVERY_METHODS),
  addressId: z.uuid().optional(),
  offerId: z.uuid().optional(),
});
export type OrderCreate = z.infer<typeof orderCreateSchema>;

export const shipSchema = z.object({
  carrier: z.enum(CARRIERS),
  trackingNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8,30}$/, 'TRACKING_INVALID'),
});
export const handoverVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'CODE_INVALID') });
export const cancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

export type OrderStatusCode =
  | 'CHECKOUT_PENDING'
  | 'PAYMENT_FAILED'
  | 'EXPIRED'
  | 'PAID'
  | 'HANDOVER_PENDING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'DISPUTED'
  | 'RETURN_IN_TRANSIT'
  | 'COMPLETED'
  | 'REFUNDED'
  | 'CANCELLED';

export interface OrderAmountsDto {
  itemPriceCents: number;
  shippingPriceCents: number;
  buyerFeeCents: number;
  buyerFeeVatCents: number;
  totalCents: number;
  sellerNetCents: number;
  refundedCents: number;
}

export interface CheckoutResponse {
  orderId: string;
  provider: 'stripe' | 'fake';
  clientSecret: string;
  amounts: OrderAmountsDto;
}

export interface ListingSnapshot {
  id: string;
  title: string;
  slug: string;
  shortId: string;
  condition: ItemCondition;
  imageKey: string | null;
}

export type OrderAction =
  | 'pay'
  | 'ship'
  | 'cancel'
  | 'requestCancel'
  | 'acceptCancel'
  | 'confirmReceipt'
  | 'showHandoverCode'
  | 'verifyHandover';

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatusCode;
  role: 'BUYER' | 'SELLER';
  deliveryMethod: DeliveryMethodCode;
  listing: ListingSnapshot;
  totalCents: number;
  sellerNetCents: number;
  counterpart: { id: string; username: string | null; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetail extends OrderSummary {
  amounts: OrderAmountsDto;
  payoutStatus: string;
  shippingAddress: Record<string, string | null> | null;
  shipments: Array<{
    carrier: string | null;
    trackingNumber: string | null;
    status: string;
    shippedAt: string | null;
  }>;
  deadlines: {
    reservedUntil: string | null;
    shipBy: string | null;
    autoCompleteAt: string | null;
    nextActionAt: string | null;
  };
  timeline: Array<{ event: string; toStatus: string; actorRole: string; at: string }>;
  actions: OrderAction[];
  /** Pending mutual-cancellation request, if any. */
  cancelRequest: { byMe: boolean; at: string } | null;
  handoverLockedTill: string | null;
}

export interface PaymentAccountDto {
  provider: string;
  transfersEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
}

export interface BalanceDto {
  /** Owed to the seller for paid orders not yet completed. */
  heldCents: number;
  /** Completed, transfer requested but not executed (e.g. account on hold). */
  scheduledCents: number;
  transferredCents: number;
}
