import { z } from 'zod';

/** DAC7 seller data (SPEC §14.4); tax code, birth date and IBAN are encrypted at rest. */
export const taxProfileSchema = z.object({
  legalName: z.string().trim().min(2, 'required').max(150),
  taxId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{11,16}$/, 'TAX_ID_INVALID'),
  birthDate: z.iso.date('required'),
  vatNumber: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'VAT_INVALID')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  addressLine: z.string().trim().min(3, 'required').max(150),
  cap: z.string().regex(/^\d{5}$/, 'CAP_INVALID'),
  city: z.string().trim().min(2, 'required').max(100),
  iban: z
    .string()
    .trim()
    .toUpperCase()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/, 'IBAN_INVALID')),
});
export type TaxProfileInput = z.infer<typeof taxProfileSchema>;

/** Never the full secrets: masked for display. */
export interface TaxProfileView {
  legalName: string;
  taxIdMasked: string;
  birthDateSet: boolean;
  vatNumber: string | null;
  addressLine: string;
  cap: string;
  city: string;
  ibanMasked: string | null;
  collectedAt: string;
}

export interface TaxStatus {
  /** The platform needs the data (a threshold is close or exceeded). */
  required: boolean;
  profile: TaxProfileView | null;
  year: { activities: number; considerationCents: number; reportable: boolean };
}

export interface AdminDac7Row {
  userId: string;
  email: string;
  username: string | null;
  activities: number;
  considerationCents: number;
  feesCents: number;
  reportable: boolean;
  requestProfile: boolean;
  hasProfile: boolean;
  remindersSent: number;
  lastReminderAt: string | null;
}

export interface AdminDashboard {
  gmv30dCents: number;
  orders30d: number;
  ordersByStatus: Record<string, number>;
  disputeRateBps: number;
  avgShipHours: number | null;
  backlog: {
    reports: number;
    listings: number;
    appeals: number;
    shops: number;
    disputes: number;
    feedback: number;
    webhooksFailed: number;
  };
  /** DSA transparency figures, last 12 months. */
  dsa: {
    reports: number;
    actions: number;
    automatedActions: number;
    appeals: number;
    reversed: number;
    medianDecisionHours: number | null;
  };
}

export interface AdminAuditItem {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AdminWebhookItem {
  provider: string;
  eventId: string;
  type: string;
  receivedAt: string;
  processedAt: string | null;
  attempts: number;
  lastError: string | null;
}

export const settingUpdateSchema = z.object({ value: z.unknown() });
