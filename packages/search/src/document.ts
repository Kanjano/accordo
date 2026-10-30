import type { Prisma } from '@accordo/db';

/** Statuses kept in the index (SPEC §9.1). */
export const INDEXED_STATUSES = ['ACTIVE', 'RESERVED'] as const;

/** Meilisearch `listings` document (SPEC §9.1; `imageKey` instead of a full URL, like the rest of the API). */
export interface ListingDocument {
  id: string;
  shortId: string;
  slug: string;
  title: string;
  description: string;
  brand: string | null;
  brandSlug: string | null;
  model: string | null;
  departmentSlug: string;
  categorySlug: string;
  categoryName: string;
  condition: string;
  year: number | null;
  priceCents: number;
  isNegotiable: boolean;
  sellerType: 'PRIVATE' | 'BUSINESS';
  sellerId: string;
  sellerUsername: string | null;
  sellerPositivePctBps: number | null;
  sellerScore: number;
  isTopSeller: boolean;
  protectedPayment: boolean;
  shippingAvailable: boolean;
  handDelivery: boolean;
  regioneSlug: string;
  provinciaSigla: string;
  comuneId: string;
  comuneName: string;
  /** Omitted when the comune has no coordinates. */
  _geo?: { lat: number; lng: number };
  attr: Record<string, unknown>;
  imageKey: string | null;
  imagesCount: number;
  status: (typeof INDEXED_STATUSES)[number];
  /** Unix seconds. */
  publishedAt: number;
  bumpedAt: number;
}

export const documentInclude = {
  brand: { select: { name: true, slug: true } },
  category: { select: { slug: true, name: true, department: { select: { slug: true } } } },
  comune: {
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      provincia: { select: { sigla: true, regione: { select: { slug: true } } } },
    },
  },
  seller: {
    select: {
      username: true,
      reputation: { select: { sellerPositivePctBps: true, score: true, isTopSeller: true } },
    },
  },
  images: {
    where: { width: { gt: 0 } },
    orderBy: { position: 'asc' },
    select: { storageKey: true },
  },
} satisfies Prisma.ListingInclude;
export type ListingForDocument = Prisma.ListingGetPayload<{ include: typeof documentInclude }>;

const seconds = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : 0);

export function toListingDocument(l: ListingForDocument): ListingDocument {
  const rep = l.seller.reputation;
  const lat = l.lat ?? l.comune.lat;
  const lng = l.lng ?? l.comune.lng;
  return {
    id: l.id,
    shortId: l.shortId,
    slug: l.slug,
    title: l.title,
    description: l.description.slice(0, 2000),
    brand: l.brand?.name ?? null,
    brandSlug: l.brand?.slug ?? null,
    model: l.modelName,
    departmentSlug: l.category.department.slug,
    categorySlug: l.category.slug,
    categoryName: l.category.name,
    condition: l.condition,
    year: l.year,
    priceCents: l.priceCents,
    isNegotiable: l.isNegotiable,
    sellerType: l.shopId ? 'BUSINESS' : 'PRIVATE',
    sellerId: l.sellerId,
    sellerUsername: l.seller.username,
    sellerPositivePctBps: rep?.sellerPositivePctBps ?? null,
    sellerScore: rep?.score ?? 0,
    isTopSeller: rep?.isTopSeller ?? false,
    protectedPayment: l.protectedPaymentEnabled,
    shippingAvailable: l.shippingIntegrated || l.shippingSelf,
    handDelivery: l.handDeliveryEnabled,
    regioneSlug: l.comune.provincia.regione.slug,
    provinciaSigla: l.comune.provincia.sigla,
    comuneId: l.comune.id,
    comuneName: l.comune.name,
    ...(lat !== null && lng !== null ? { _geo: { lat, lng } } : {}),
    attr: (l.attributes ?? {}) as Record<string, unknown>,
    imageKey: l.images[0]?.storageKey ?? null,
    imagesCount: l.images.length,
    status: l.status as ListingDocument['status'],
    publishedAt: seconds(l.publishedAt),
    bumpedAt: seconds(l.bumpedAt ?? l.publishedAt),
  };
}
