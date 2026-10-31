import { z } from 'zod';

export const FEEDBACK_RATINGS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const;
export type FeedbackRatingCode = (typeof FEEDBACK_RATINGS)[number];
/** Removal reasons (SPEC §8.8). */
export const FEEDBACK_REMOVAL_REASONS = [
  'OFFENSIVE',
  'PERSONAL_DATA',
  'CONTACT_OR_LINKS',
  'EXTORTION',
  'UNRELATED',
  'ILLEGAL',
  'AUTHOR_BANNED_FOR_FRAUD',
  'DISPUTE_ABUSE',
] as const;
export const FEEDBACK_REPORT_REASONS = [
  'EXTORTION',
  'OFFENSIVE',
  'PERSONAL_DATA',
  'CONTACT_OR_LINKS',
  'UNRELATED',
  'OTHER',
] as const;

const star = z.number().int().min(1).max(5);
const comment = z.string().trim().max(500).optional();

/** Content rules (comment length, detailed ratings) are checked by the domain (§8.2). */
export const feedbackCreateSchema = z.object({
  rating: z.enum(FEEDBACK_RATINGS),
  comment,
  dsr: z
    .object({
      itemAsDescribed: star.optional(),
      communication: star.optional(),
      shippingTime: star.optional(),
      packaging: star.optional(),
    })
    .optional(),
});
export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>;
export const feedbackReplySchema = z.object({ body: z.string().trim().min(1).max(500) });
export const revisionRequestSchema = z.object({ message: z.string().trim().min(1).max(500) });
export const revisionAcceptSchema = z.object({ rating: z.enum(FEEDBACK_RATINGS), comment });
export const feedbackReportSchema = z.object({
  reasonCode: z.enum(FEEDBACK_REPORT_REASONS),
  details: z.string().trim().max(1000).default(''),
});
export const feedbackModerationSchema = z.object({
  reasonCode: z.enum(FEEDBACK_REMOVAL_REASONS),
  statement: z.string().trim().min(20, 'NOTES_TOO_SHORT').max(2000),
});

export interface DsrAverage {
  avg: number;
  count: number;
}

export interface ReputationDto {
  userId: string;
  username: string;
  score: number;
  levelKey: string | null;
  sellerPositivePctBps: number | null;
  /** positive/neutral/negative received as a seller, by period (SPEC §8.9). */
  periods: Record<'m1' | 'm6' | 'm12', { positive: number; neutral: number; negative: number }>;
  /** null when fewer than 5 ratings for that criterion. */
  dsr: Record<
    'itemAsDescribed' | 'communication' | 'shippingTime' | 'packaging',
    DsrAverage | null
  >;
  topSeller: boolean;
  completedSales: number;
  completedPurchases: number;
  responseTime: 'WITHIN_HOUR' | 'WITHIN_HOURS' | 'WITHIN_DAY' | null;
  responseRateBps: number | null;
}

export interface FeedbackItem {
  id: string;
  orderId: string;
  role: 'BUYER_TO_SELLER' | 'SELLER_TO_BUYER';
  rating: FeedbackRatingCode;
  comment: string | null;
  dsr: {
    itemAsDescribed: number | null;
    communication: number | null;
    shippingTime: number | null;
    packaging: number | null;
  };
  /** Masked author name (e.g. m***o) and their score. */
  author: { name: string; score: number };
  recipient: { name: string };
  listingTitle: string;
  reply: string | null;
  revised: boolean;
  countsTowardScore: boolean;
  /** Only shown to the people concerned. */
  status: 'PUBLISHED' | 'HIDDEN' | 'REMOVED';
  createdAt: string;
  /** What the viewer may do on it. */
  actions: Array<'reply' | 'requestRevision' | 'report'>;
}

export interface PendingFeedback {
  orderId: string;
  orderNumber: string;
  role: 'BUYER_TO_SELLER' | 'SELLER_TO_BUYER';
  counterpart: string;
  listingTitle: string;
  deliveryMethod: 'SHIPPING_INTEGRATED' | 'SHIPPING_SELF' | 'HAND_DELIVERY';
  deadline: string;
}

export interface RevisionRequestItem {
  id: string;
  feedbackId: string;
  message: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  expiresAt: string;
  listingTitle: string;
  rating: FeedbackRatingCode;
  comment: string | null;
  /** Viewer is the buyer who must answer. */
  mine: boolean;
}
