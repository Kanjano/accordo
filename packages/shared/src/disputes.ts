import { z } from 'zod';

export const DISPUTE_REASONS = [
  'NOT_RECEIVED',
  'NOT_AS_DESCRIBED',
  'DAMAGED',
  'COUNTERFEIT',
  'INCOMPLETE',
  'OTHER',
] as const;
export type DisputeReasonCode = (typeof DISPUTE_REASONS)[number];
export const DISPUTE_OUTCOMES = [
  'REFUND_FULL',
  'REFUND_FULL_WITH_RETURN',
  'REFUND_PARTIAL',
  'RELEASE_TO_SELLER',
] as const;
export type DisputeOutcomeCode = (typeof DISPUTE_OUTCOMES)[number];
export const SELLER_RESPONSES = [
  'ACCEPT_REFUND_WITH_RETURN',
  'ACCEPT_REFUND',
  'PROPOSE_PARTIAL',
  'REJECT',
] as const;

/** Uploaded photos: temporary keys from `POST /media/upload-url`. */
const evidenceKeys = z.array(z.string().max(300)).max(10);
const message = z.string().trim().min(1).max(2000);

export const disputeOpenSchema = z.object({
  reason: z.enum(DISPUTE_REASONS),
  description: z.string().trim().min(30, 'DESCRIPTION_TOO_SHORT').max(5000),
  evidenceKeys: evidenceKeys.default([]),
});
export const disputeMessageSchema = z.object({ body: message });
export const disputeEvidenceSchema = z.object({ evidenceKeys: evidenceKeys.min(1) });
export const disputeRespondSchema = z.object({
  action: z.enum(SELLER_RESPONSES),
  amountCents: z.number().int().positive().optional(),
  message,
});
export const disputeResolveSchema = z.object({
  outcome: z.enum(DISPUTE_OUTCOMES),
  refundCents: z.number().int().positive().optional(),
  sellerAtFault: z.boolean(),
  /** Written motivation sent to both parties (SPEC §6.6). */
  notes: z.string().trim().min(20, 'NOTES_TOO_SHORT').max(5000),
});
export const appealDecisionSchema = z.object({
  upheld: z.boolean(),
  notes: z.string().trim().min(20, 'NOTES_TOO_SHORT').max(5000),
});
export const adminRefundSchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(10).max(1000),
});

export type DisputeAvailableAction =
  | 'respond'
  | 'acceptProposal'
  | 'escalate'
  | 'withdraw'
  | 'appeal'
  | 'message'
  | 'addEvidence';

export interface DisputeDetail {
  id: string;
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  itemPriceCents: number;
  totalCents: number;
  /** Viewer's side; SUPPORT for the staff. */
  role: 'BUYER' | 'SELLER' | 'SUPPORT';
  reason: DisputeReasonCode;
  description: string;
  status: 'OPEN' | 'AWAITING_BUYER' | 'UNDER_REVIEW' | 'AWAITING_RETURN' | 'RESOLVED' | 'WITHDRAWN';
  outcome: DisputeOutcomeCode | null;
  proposedRefundCents: number | null;
  resolvedRefundCents: number | null;
  resolutionNotes: string | null;
  sellerAtFault: boolean | null;
  sellerResponseDueAt: string | null;
  buyerResponseDueAt: string | null;
  resolvedAt: string | null;
  appealedAt: string | null;
  appealResolvedAt: string | null;
  appealUpheld: boolean | null;
  appealNotes: string | null;
  messages: Array<{ id: string; authorRole: string; body: string; createdAt: string }>;
  evidence: Array<{
    id: string;
    uploadedByRole: 'BUYER' | 'SELLER' | 'SUPPORT';
    createdAt: string;
  }>;
  actions: DisputeAvailableAction[];
  createdAt: string;
}
