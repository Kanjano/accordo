import { z } from 'zod';

export const REPORT_TARGETS = ['LISTING', 'USER', 'MESSAGE', 'SHOP'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number] | 'FEEDBACK';
export const REPORT_REASONS = [
  'SCAM',
  'PROHIBITED_ITEM',
  'COUNTERFEIT',
  'STOLEN',
  'IP_INFRINGEMENT',
  'OFFENSIVE',
  'SPAM',
  'MISLEADING',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Grounds used in decisions and statements of reasons (DSA art. 17). */
export const MODERATION_REASONS = [...REPORT_REASONS, 'TERMS_VIOLATION', 'FRAUD', 'ABUSE'] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

const statement = z.string().trim().min(20, 'NOTES_TOO_SHORT').max(3000);

/** SPEC §14.2 notice & action: anonymous reporters must give name and email. */
export const reportCreateSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.uuid(),
  reasonCode: z.enum(REPORT_REASONS),
  details: z.string().trim().min(20, 'DETAILS_TOO_SHORT').max(3000),
  isIllegalContent: z.boolean().default(false),
  goodFaithConfirmed: z.literal(true, 'GOOD_FAITH_REQUIRED'),
  reporterName: z.string().trim().min(2).max(100).optional(),
  reporterEmail: z.email('EMAIL_INVALID').optional(),
});
export type ReportCreate = z.infer<typeof reportCreateSchema>;

export const REPORT_DECISIONS = [
  'DISMISS',
  'REMOVE_LISTING',
  'HIDE_MESSAGE',
  'WARN_USER',
  'LIMIT_USER',
  'SUSPEND_USER',
  'BAN_USER',
] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];

export const reportDecisionSchema = z.object({
  decision: z.enum(REPORT_DECISIONS),
  reasonCode: z.enum(MODERATION_REASONS),
  statement,
  legalGround: z.string().trim().max(300).optional(),
  days: z.number().int().min(1).max(365).optional(),
});
export type ReportDecisionInput = z.infer<typeof reportDecisionSchema>;

export const moderationReasonSchema = z.object({
  reasonCode: z.enum(MODERATION_REASONS),
  statement,
  legalGround: z.string().trim().max(300).optional(),
});

export const SANCTIONS = ['WARN', 'LIMIT', 'SUSPEND', 'BAN'] as const;
export type Sanction = (typeof SANCTIONS)[number];
export const sanctionSchema = moderationReasonSchema.extend({
  type: z.enum(SANCTIONS),
  /** Suspension length; ignored for the other sanctions. */
  days: z.number().int().min(1).max(365).default(7),
});
export const reinstateSchema = z.object({ statement });

export const moderationAppealSchema = z.object({
  text: z.string().trim().min(20, 'DETAILS_TOO_SHORT').max(3000),
});
export const moderationAppealDecisionSchema = z.object({
  outcome: z.enum(['UPHELD', 'REVERSED']),
  statement,
});

export interface MyReportItem {
  id: string;
  targetType: ReportTarget;
  targetLabel: string;
  reasonCode: string;
  status: 'OPEN' | 'IN_REVIEW' | 'ACTION_TAKEN' | 'DISMISSED';
  decision: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface AdminReportItem extends MyReportItem {
  targetId: string;
  details: string;
  isIllegalContent: boolean;
  reporter: { userId: string | null; name: string | null; email: string | null };
  /** Web path of the reported content, when it still exists. */
  targetPath: string | null;
  /** The user the content belongs to. */
  targetUserId: string | null;
  /** Earlier reports on the same target. */
  sameTarget: number;
}

export interface ModerationActionItem {
  id: string;
  actionType: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  reasonCode: string;
  statementOfReasons: string;
  legalGround: string | null;
  automated: boolean;
  createdAt: string;
  appealable: boolean;
  /** The affected user may still appeal (once, within 6 months). */
  canAppeal: boolean;
  appealedAt: string | null;
  appealText: string | null;
  appealOutcome: 'UPHELD' | 'REVERSED' | null;
  appealStatement: string | null;
  appealDecidedAt: string | null;
}

export interface AdminAppealItem extends ModerationActionItem {
  targetUser: { id: string; email: string; username: string | null } | null;
  moderatorId: string | null;
}

export interface AdminUserItem {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  status: 'ACTIVE' | 'LIMITED' | 'SUSPENDED' | 'BANNED' | 'DELETED';
  banExpires: string | null;
  createdAt: string;
  twoFactorEnabled: boolean;
}

export interface AdminUserDetail extends AdminUserItem {
  accountType: 'PRIVATE' | 'BUSINESS';
  lastSeenAt: string | null;
  counts: {
    listings: number;
    purchases: number;
    sales: number;
    reportsAgainst: number;
    flaggedMessages: number;
  };
  actions: ModerationActionItem[];
}

export interface AdminListingItem {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  status: string;
  priceCents: number;
  seller: { id: string; username: string | null; email: string };
  rejectionReason: string | null;
  reports: number;
  imageKey: string | null;
  updatedAt: string;
}
