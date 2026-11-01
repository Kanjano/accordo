import { z } from 'zod';

export const ITEM_CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'EXCELLENT',
  'GOOD',
  'FAIR',
  'FOR_PARTS',
] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];
export const PARCEL_SIZES = ['S', 'M', 'L', 'XL'] as const;
export type ParcelSize = (typeof PARCEL_SIZES)[number];
export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'PAUSED',
  'RESERVED',
  'SOLD',
  'EXPIRED',
  'REJECTED',
  'REMOVED',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

const uuid = z.uuid();
const comuneId = z.string().regex(/^\d{6}$/);
const currentYear = new Date().getUTCFullYear();

/** Fields editable by the seller. Drafts accept partial data; publish checks completeness server-side. */
export const listingFieldsSchema = z.object({
  categoryId: uuid,
  title: z.string().trim().min(3, 'TITLE_TOO_SHORT').max(120, 'TITLE_TOO_LONG'),
  brandId: uuid.nullable(),
  modelName: z.string().trim().max(120).nullable(),
  year: z
    .number()
    .int()
    .min(1900)
    .max(currentYear + 1)
    .nullable(),
  condition: z.enum(ITEM_CONDITIONS),
  attributes: z.record(z.string(), z.unknown()),
  description: z.string().trim().max(5000, 'DESCRIPTION_TOO_LONG'),
  priceCents: z.number().int().min(0).max(100_000_000),
  isNegotiable: z.boolean(),
  acceptsTrades: z.boolean(),
  comuneId,
  protectedPaymentEnabled: z.boolean(),
  shippingIntegrated: z.boolean(),
  parcelSize: z.enum(PARCEL_SIZES).nullable(),
  shippingSelf: z.boolean(),
  selfShippingPriceCents: z.number().int().min(0).max(100_000).nullable(),
  handDeliveryEnabled: z.boolean(),
});

export const listingCreateSchema = listingFieldsSchema
  .pick({ categoryId: true, title: true, condition: true })
  .extend(
    listingFieldsSchema.omit({ categoryId: true, title: true, condition: true }).partial().shape,
  );
export type ListingCreate = z.infer<typeof listingCreateSchema>;

export const listingUpdateSchema = listingFieldsSchema.partial();
export type ListingUpdate = z.infer<typeof listingUpdateSchema>;

export const imageAttachSchema = z.object({
  key: z.string().min(10).max(300),
  altText: z.string().trim().max(200).optional(),
});
export const imageOrderSchema = z.object({ imageIds: z.array(uuid).min(1).max(20) });
export const uploadUrlSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z
    .number()
    .int()
    .positive()
    .max(15 * 1024 * 1024),
});

export interface UploadUrlResponse {
  url: string;
  fields: Record<string, string>;
  key: string;
}

export interface ListingImageDto {
  id: string;
  key: string;
  width: number;
  height: number;
  position: number;
  altText: string | null;
  blurDataUrl: string | null;
  /** False while the worker is still producing the variants. */
  ready: boolean;
}

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
  department: { slug: string; name: string };
  shippable: boolean;
  defaultParcelSize: ParcelSize | null;
}

export interface ListingDetail {
  id: string;
  shortId: string;
  slug: string;
  status: ListingStatus;
  title: string;
  description: string;
  condition: ItemCondition;
  year: number | null;
  brand: { id: string; name: string; slug: string } | null;
  modelName: string | null;
  category: CategoryRef;
  attributes: Array<{
    key: string;
    label: string;
    value: string;
    unit: string | null;
    raw: unknown;
  }>;
  rawAttributes: Record<string, unknown>;
  priceCents: number;
  currency: 'EUR';
  /** Latest cut, shown for 30 days; `lowest30dCents` only for shops (Omnibus, SPEC §14.3). */
  priceReduction: {
    previousCents: number;
    lowest30dCents: number | null;
    reducedAt: string;
  } | null;
  isNegotiable: boolean;
  acceptsTrades: boolean;
  protectedPaymentEnabled: boolean;
  shippingIntegrated: boolean;
  parcelSize: ParcelSize | null;
  /** Price paid by the buyer for integrated shipping (parcel size, §7.1). */
  integratedShippingPriceCents: number | null;
  shippingSelf: boolean;
  selfShippingPriceCents: number | null;
  handDeliveryEnabled: boolean;
  location: {
    comuneId: string;
    comune: string;
    provincia: string;
    provinciaSigla: string;
    regione: string;
  };
  images: ListingImageDto[];
  sellerType: 'PRIVATE' | 'BUSINESS';
  seller: {
    id: string;
    username: string | null;
    displayName: string;
    memberSince: string;
    positivePctBps: number | null;
    feedbackCount: number;
    levelKey: string | null;
    topSeller: boolean;
    identityVerified: boolean;
    shop: {
      slug: string;
      name: string;
      legalName: string;
      vatNumber: string;
      address: string;
      verified: boolean;
      reaNumber: string | null;
      email: string;
      phone: string;
      returnPolicy: string | null;
      warrantyInfo: string | null;
    } | null;
  };
  publishedAt: string | null;
  expiresAt: string | null;
  bumpedAt: string | null;
  soldAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Owner-only data. */
  owner: {
    viewsCount: number;
    favoritesCount: number;
    rejectionReason: string | null;
    canBumpAt: string | null;
  } | null;
}

export interface MyListingItem {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  status: ListingStatus;
  priceCents: number;
  imageKey: string | null;
  viewsCount: number;
  favoritesCount: number;
  publishedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

export interface PublishResult {
  status: 'ACTIVE' | 'PENDING_REVIEW';
  reasons: string[];
}

export interface DepartmentTree {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  categories: Array<{
    id: string;
    slug: string;
    name: string;
    shippable: boolean;
    defaultParcelSize: ParcelSize | null;
  }>;
}

export interface BrandOption {
  id: string;
  name: string;
  slug: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}
