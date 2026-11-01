import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

/** SPEC §3.8. The VAT check digit is verified by the API (`isValidPartitaIva`). */
export const shopApplySchema = z.object({
  name: text(80).min(2, 'required'),
  legalName: text(120).min(2, 'required'),
  vatNumber: z
    .string()
    .trim()
    .regex(/^(IT)?\d{11}$/i, 'VAT_INVALID')
    .transform((v) => v.replace(/^IT/i, '')),
  reaNumber: optional(20),
  pec: z
    .email('EMAIL_INVALID')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  email: z.email('EMAIL_INVALID'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s]{6,20}$/, 'PHONE_INVALID'),
  website: z
    .url('URL_INVALID')
    .refine((u) => /^https?:\/\//.test(u), 'URL_INVALID')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  addressLine: text(150).min(3, 'required'),
  cap: z.string().regex(/^\d{5}$/, 'CAP_INVALID'),
  comuneId: z.string().regex(/^\d{6}$/, 'required'),
  description: optional(2000),
  openingHours: optional(500),
  /** Consumer information for B2C sales (SPEC §14.3): mandatory. */
  returnPolicy: text(2000).min(20, 'TEXT_TOO_SHORT'),
  warrantyInfo: text(2000).min(20, 'TEXT_TOO_SHORT'),
  /** DSA trader self-certification (SPEC §14.2). */
  traderSelfCertified: z.literal(true, 'SELF_CERT_REQUIRED'),
});
export type ShopApply = z.infer<typeof shopApplySchema>;
/** Legal data (legal name, VAT, address) is frozen once verified; the API enforces it. */
export const shopUpdateSchema = shopApplySchema.omit({ traderSelfCertified: true }).partial();
export type ShopUpdate = z.infer<typeof shopUpdateSchema>;
export const shopRejectSchema = z.object({ reason: text(1000).min(20, 'NOTES_TOO_SHORT') });
export const shopMediaSchema = z.object({
  kind: z.enum(['logo', 'cover']),
  key: z.string().min(1).max(200),
});

export type ShopStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface ShopLegalInfo {
  legalName: string;
  vatNumber: string;
  reaNumber: string | null;
  address: string;
  email: string;
  phone: string;
  pec: string | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
}

export interface ShopDirectoryItem {
  slug: string;
  name: string;
  logoKey: string | null;
  comune: string;
  provinciaSigla: string;
  regione: string;
  activeListings: number;
}

export interface ShopPublic extends ShopDirectoryItem {
  id: string;
  ownerUsername: string | null;
  description: string | null;
  openingHours: string | null;
  website: string | null;
  coverKey: string | null;
  verifiedAt: string | null;
  legal: ShopLegalInfo;
}

/** The owner's view (`GET /me/shop`). */
export interface MyShop {
  id: string;
  status: ShopStatus;
  rejectionReason: string | null;
  slug: string;
  name: string;
  legalName: string;
  vatNumber: string;
  reaNumber: string | null;
  pec: string | null;
  email: string;
  phone: string;
  website: string | null;
  addressLine: string;
  cap: string;
  comune: { id: string; name: string; provinciaSigla: string };
  description: string | null;
  openingHours: string | null;
  returnPolicy: string | null;
  warrantyInfo: string | null;
  logoKey: string | null;
  coverKey: string | null;
}

export interface AdminShopItem extends MyShop {
  owner: { id: string; email: string; username: string | null };
  createdAt: string;
}
