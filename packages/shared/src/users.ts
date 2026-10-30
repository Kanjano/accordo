import { z } from 'zod';

/** Lowercase letters, digits, dot and underscore; 3–30 characters. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._]{3,30}$/, 'USERNAME_FORMAT');

export const passwordSchema = z
  .string()
  .min(10, 'PASSWORD_TOO_SHORT')
  .max(128, 'PASSWORD_TOO_LONG');

export const signUpSchema = z.object({
  name: z.string().trim().min(2, 'NAME_REQUIRED').max(60),
  username: usernameSchema,
  email: z.email('EMAIL_INVALID').trim().toLowerCase(),
  password: passwordSchema,
  acceptTerms: z.literal(true, 'TERMS_REQUIRED'),
  marketingConsent: z.boolean().default(false),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  comuneId: z
    .string()
    .regex(/^\d{6}$/)
    .nullable()
    .optional(),
  marketingConsent: z.boolean().optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const addressTypeSchema = z.enum(['SHIPPING', 'SENDER']);

export const addressInputSchema = z.object({
  type: addressTypeSchema,
  fullName: z.string().trim().min(2).max(100),
  line1: z.string().trim().min(3).max(150),
  line2: z.string().trim().max(150).nullable().optional(),
  cap: z.string().regex(/^\d{5}$/, 'CAP_INVALID'),
  comuneId: z.string().regex(/^\d{6}$/),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[\d\s]{6,20}$/, 'PHONE_INVALID'),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressInputSchema>;
export const addressUpdateSchema = addressInputSchema.partial();

export interface Address extends AddressInput {
  id: string;
  comune: { id: string; name: string; provinciaSigla: string };
}

export interface MeResponse {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  username: string | null;
  image: string | null;
  bio: string | null;
  accountType: 'PRIVATE' | 'BUSINESS';
  role: string;
  twoFactorEnabled: boolean;
  marketingConsent: boolean;
  comune: { id: string; name: string; provinciaSigla: string } | null;
  createdAt: string;
}

export type ActivityLevel = 'TODAY' | 'THIS_WEEK' | null;

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  image: string | null;
  bio: string | null;
  location: { comune: string; provinciaSigla: string } | null;
  memberSince: string;
  activity: ActivityLevel;
  responseTime: 'WITHIN_HOUR' | 'WITHIN_HOURS' | 'WITHIN_DAY' | null;
  accountType: 'PRIVATE' | 'BUSINESS';
  badges: {
    emailVerified: boolean;
    identityVerified: boolean;
    shopVerified: boolean;
    topSeller: boolean;
    levelKey: string | null;
  };
  reputation: {
    score: number;
    sellerPositivePctBps: number | null;
    sellerPositive12m: number;
    sellerNeutral12m: number;
    sellerNegative12m: number;
    completedSales: number;
    completedPurchases: number;
  };
  shop: { slug: string; name: string } | null;
  activeListingsCount: number;
  followersCount: number;
  viewer: { isFollowing: boolean; isBlocked: boolean; isSelf: boolean } | null;
}

export interface ListingCardItem {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  priceCents: number;
  currency: 'EUR';
  condition: string;
  location: { comune: string; provinciaSigla: string };
  publishedAt: string | null;
  imageKey: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ComuneOption {
  id: string;
  name: string;
  provinciaSigla: string;
  caps: string[];
}

export const consentSchema = z.object({
  version: z.number().int().positive(),
  analytics: z.boolean(),
});
export type ConsentInput = z.infer<typeof consentSchema>;
