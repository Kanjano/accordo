import type { Prisma, PrismaClient } from '@accordo/db';
import { evaluateListingChecks, generateShortId, isSimilarImage, slugify } from '@accordo/domain';
import {
  type AttributeDef,
  buildAttributesSchema,
  type ListingCardItem,
  type ListingCreate,
  type ListingDetail,
  type ListingStatus,
  type ListingUpdate,
  type MyListingItem,
  type PublishResult,
} from '@accordo/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service.js';
import { PRISMA } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';
import { RateLimitService } from '../platform/rate-limit.service.js';
import { SettingsService } from '../platform/settings.service.js';

const DAY = 86_400_000;
const EDITABLE: ListingStatus[] = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'REJECTED',
];
/** Statuses the public can see (SPEC §3.3: sold listings stay visible). */
const PUBLIC: ListingStatus[] = ['ACTIVE', 'RESERVED', 'SOLD'];

const detailInclude = {
  category: {
    include: {
      department: true,
      attributes: { include: { attribute: true }, orderBy: { position: 'asc' } },
    },
  },
  brand: true,
  comune: { include: { provincia: { include: { regione: true } } } },
  images: { orderBy: { position: 'asc' } },
  shop: true,
  seller: { include: { reputation: true, paymentAccount: { select: { transfersEnabled: true } } } },
} satisfies Prisma.ListingInclude;
type ListingWithDetail = Prisma.ListingGetPayload<{ include: typeof detailInclude }>;

const problem = (code: string, detail?: string) => ({ code, detail });

function attributeDefs(category: ListingWithDetail['category']): AttributeDef[] {
  return category.attributes.map(({ attribute: a, required }) => ({
    key: a.key,
    label: a.label,
    type: a.type,
    unit: a.unit,
    options: (a.options as AttributeDef['options']) ?? null,
    required,
  }));
}

function displayValue(def: AttributeDef, raw: unknown): string {
  if (def.type === 'BOOLEAN') return raw ? 'Sì' : 'No';
  const label = (v: unknown) => def.options?.find((o) => o.value === v)?.label ?? String(v);
  return Array.isArray(raw) ? raw.map(label).join(', ') : label(raw);
}

@Injectable()
export class ListingsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly settings: SettingsService,
    private readonly rateLimit: RateLimitService,
    private readonly catalog: CatalogService,
  ) {}

  // ───────────── Create / update ─────────────

  async create(userId: string, input: ListingCreate): Promise<ListingDetail> {
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { shop: { select: { id: true } } },
    });
    const young = Date.now() - user.createdAt.getTime() < 7 * DAY;
    // SPEC §13.2: 20 listings/day, 5/day for accounts younger than 7 days.
    await this.rateLimit.consume(`listing-create:${userId}`, young ? 5 : 20, 24 * 3600);

    const category = await this.activeCategory(input.categoryId);
    const comuneId = input.comuneId ?? user.comuneId;
    if (!comuneId) throw new BadRequestException(problem('COMUNE_REQUIRED'));
    const data = await this.normalise({ ...input, comuneId }, category, null);

    for (let attempt = 0; ; attempt++) {
      try {
        const listing = await this.db.listing.create({
          data: {
            ...data,
            shortId: generateShortId(),
            slug: slugify(input.title),
            sellerId: userId,
            shopId: user.shop?.id ?? null,
            status: 'DRAFT',
            title: input.title,
            categoryId: category.id,
            condition: input.condition,
            description: input.description ?? '',
            priceCents: input.priceCents ?? 0,
            comuneId,
          },
        });
        return this.detail(listing.id, userId);
      } catch (e) {
        // shortId collision (P2002) is astronomically rare: retry with a new one.
        if ((e as { code?: string }).code !== 'P2002' || attempt >= 3) throw e;
      }
    }
  }

  async update(userId: string, id: string, input: ListingUpdate): Promise<ListingDetail> {
    const current = await this.own(userId, id);
    if (!EDITABLE.includes(current.status))
      throw new ConflictException(problem('LISTING_NOT_EDITABLE'));
    if (input.priceCents === 0 && current.status !== 'DRAFT')
      throw new BadRequestException(problem('PRICE_REQUIRED'));
    const category = input.categoryId
      ? await this.activeCategory(input.categoryId)
      : current.category;
    const data = await this.normalise(input, category, current);
    const priceChanged =
      input.priceCents !== undefined &&
      input.priceCents !== current.priceCents &&
      current.status !== 'DRAFT';
    const priceDrop = priceChanged && (input.priceCents as number) < current.priceCents;
    // SPEC §3.3: category change or a price cut above 50% re-runs the automatic checks.
    const substantial =
      current.status === 'ACTIVE' &&
      ((input.categoryId && input.categoryId !== current.categoryId) ||
        (priceDrop && (input.priceCents as number) * 2 < current.priceCents));

    await this.db.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: { ...data, ...(input.title ? { slug: slugify(input.title) } : {}) },
      });
      if (priceChanged) {
        await tx.listingPriceHistory.create({
          data: { listingId: id, priceCents: input.priceCents as number },
        });
      }
      if (priceDrop && current.status === 'ACTIVE') {
        await writeOutbox(tx, {
          aggregateType: 'Listing',
          aggregateId: id,
          type: 'listing.price_dropped',
          payload: {
            listingId: id,
            fromCents: current.priceCents,
            toCents: input.priceCents as number,
          },
        });
      }
      await writeOutbox(tx, {
        aggregateType: 'Listing',
        aggregateId: id,
        type: 'listing.updated',
        payload: { listingId: id },
      });
    });
    if (substantial) await this.applyChecks(id);
    return this.detail(id, userId);
  }

  /** Validates references and per-category attributes; turns off shipping for non-shippable categories. */
  private async normalise(
    input: ListingUpdate,
    category: { id: string; shippable: boolean; defaultParcelSize: string | null },
    current: ListingWithDetail | null,
  ): Promise<Prisma.ListingUncheckedUpdateInput & Prisma.ListingUncheckedCreateInput> {
    const data = { ...input } as Prisma.ListingUncheckedCreateInput;
    if (
      input.brandId &&
      !(await this.db.brand.findUnique({ where: { id: input.brandId }, select: { id: true } }))
    ) {
      throw new BadRequestException(problem('BRAND_NOT_FOUND'));
    }
    if (input.comuneId) {
      const comune = await this.db.comune.findUnique({
        where: { id: input.comuneId },
        select: { lat: true, lng: true },
      });
      if (!comune) throw new BadRequestException(problem('COMUNE_NOT_FOUND'));
      // Approximate location only: the comune centroid (SPEC §3.3).
      Object.assign(data, { lat: comune.lat, lng: comune.lng });
    }
    if (input.attributes !== undefined || input.categoryId) {
      const defs = await this.catalog.attributes(category.id);
      const parsed = buildAttributesSchema(defs, { partial: true }).safeParse(
        input.attributes ?? current?.attributes ?? {},
      );
      if (!parsed.success) {
        // A category change drops attributes that no longer apply.
        if (input.attributes !== undefined)
          throw new BadRequestException(problem('INVALID_ATTRIBUTES', parsed.error.message));
        data.attributes = {};
      } else {
        data.attributes = parsed.data as Prisma.InputJsonValue;
      }
    }
    if (!category.shippable)
      Object.assign(data, {
        shippingIntegrated: false,
        shippingSelf: false,
        handDeliveryEnabled: true,
        parcelSize: null,
      });
    else {
      // Integrated shipping always has a parcel size: the category default unless the seller picked one.
      const integrated = input.shippingIntegrated ?? current?.shippingIntegrated;
      const size = input.parcelSize === undefined ? current?.parcelSize : input.parcelSize;
      if (integrated && !size) data.parcelSize = category.defaultParcelSize as never;
    }
    return data as Prisma.ListingUncheckedUpdateInput & Prisma.ListingUncheckedCreateInput;
  }

  private async activeCategory(id: string) {
    const category = await this.db.category.findFirst({ where: { id, isActive: true } });
    if (!category) throw new BadRequestException(problem('CATEGORY_NOT_FOUND'));
    return category;
  }

  // ───────────── Publication and checks ─────────────

  /** Completeness required to publish (drafts may be partial). */
  private incompleteFields(l: ListingWithDetail, defs: AttributeDef[]): string[] {
    const missing: string[] = [];
    if (l.priceCents <= 0) missing.push('priceCents');
    if (l.description.trim().length < 10) missing.push('description');
    if (!l.images.length) missing.push('images');
    if (l.images.some((i) => i.width === 0)) missing.push('imagesProcessing');
    if (!l.shippingIntegrated && !l.shippingSelf && !l.handDeliveryEnabled)
      missing.push('delivery');
    if (l.shippingIntegrated && !l.parcelSize) missing.push('parcelSize');
    if (l.shippingSelf && !l.selfShippingPriceCents) missing.push('selfShippingPriceCents');
    if (l.protectedPaymentEnabled && !l.seller.paymentAccount?.transfersEnabled)
      missing.push('protectedPayment');
    if (!buildAttributesSchema(defs).safeParse(l.attributes).success) missing.push('attributes');
    return missing;
  }

  async publish(userId: string, id: string): Promise<PublishResult> {
    const l = await this.own(userId, id);
    if (!['DRAFT', 'EXPIRED', 'REJECTED'].includes(l.status))
      throw new ConflictException(problem('LISTING_NOT_PUBLISHABLE'));
    const missing = this.incompleteFields(l, attributeDefs(l.category));
    if (missing.length) {
      throw new UnprocessableEntityException({
        code: 'LISTING_INCOMPLETE',
        detail: missing.join(','),
      });
    }
    const { durationDays } = await this.settings.get('listings');
    const now = new Date();
    await this.db.listing.update({
      where: { id },
      data: {
        publishedAt: l.publishedAt ?? now,
        bumpedAt: now,
        expiresAt: new Date(now.getTime() + durationDays * DAY),
        rejectionReason: null,
      },
    });
    return this.applyChecks(id, true);
  }

  /** SPEC §13.5 automatic checks → ACTIVE or PENDING_REVIEW (with an outbox event either way). */
  async applyChecks(id: string, publishing = false): Promise<PublishResult> {
    const l = await this.db.listing.findUniqueOrThrow({
      where: { id },
      include: { images: true, seller: true },
    });
    const [checkSettings, bannedTerms] = await Promise.all([
      this.settings.get('listingChecks'),
      this.settings.get('bannedTerms'),
    ]);
    const comparable = await this.db.listing.findMany({
      where: {
        categoryId: l.categoryId,
        brandId: l.brandId,
        status: { in: ['ACTIVE', 'SOLD', 'RESERVED'] },
        id: { not: id },
      },
      select: { priceCents: true },
      orderBy: { publishedAt: 'desc' },
      take: 500,
    });
    const result = evaluateListingChecks(
      {
        title: l.title,
        description: l.description,
        priceCents: l.priceCents,
        comparablePricesCents: comparable.map((c) => c.priceCents),
        sellerAccountAgeDays: (Date.now() - l.seller.createdAt.getTime()) / DAY,
        hasImageFromOtherSeller: await this.hasReusedImages(l),
        bannedTerms,
      },
      checkSettings,
    );
    const status: ListingStatus = result.status;
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data: { status } });
      if (publishing)
        await tx.listingPriceHistory.create({ data: { listingId: id, priceCents: l.priceCents } });
      await writeOutbox(tx, {
        aggregateType: 'Listing',
        aggregateId: id,
        type: status === 'ACTIVE' ? 'listing.published' : 'listing.review_pending',
        payload: { listingId: id, sellerId: l.sellerId, reasons: result.reasons },
      });
    });
    return { status: result.status, reasons: result.reasons };
  }

  /**
   * dHash distance ≤ 6 against other sellers' photos in the same category.
   * ponytail: linear scan bounded to 5 000 hashes; move to a BK-tree or pg extension if it grows.
   */
  private async hasReusedImages(l: {
    id: string;
    sellerId: string;
    categoryId: string;
    images: Array<{ phash: string | null }>;
  }) {
    const own = l.images.map((i) => i.phash).filter((h): h is string => !!h);
    if (!own.length) return false;
    const others = await this.db.listingImage.findMany({
      where: {
        phash: { not: null },
        listing: {
          sellerId: { not: l.sellerId },
          categoryId: l.categoryId,
          status: { not: 'DRAFT' },
        },
      },
      select: { phash: true },
      distinct: ['phash'],
      take: 5000,
    });
    return others.some((o) => own.some((h) => isSimilarImage(h, o.phash as string)));
  }

  // ───────────── Lifecycle ─────────────

  private async transition(
    userId: string,
    id: string,
    from: ListingStatus[],
    data: Prisma.ListingUpdateInput,
    event: string,
  ) {
    const l = await this.own(userId, id);
    if (!from.includes(l.status))
      throw new ConflictException(problem('LISTING_INVALID_STATE', `${l.status} → ${event}`));
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data });
      await writeOutbox(tx, {
        aggregateType: 'Listing',
        aggregateId: id,
        type: `listing.${event}`,
        payload: { listingId: id },
      });
    });
    return this.detail(id, userId);
  }

  pause(userId: string, id: string) {
    return this.transition(userId, id, ['ACTIVE'], { status: 'PAUSED' }, 'paused');
  }

  async resume(userId: string, id: string) {
    const l = await this.own(userId, id);
    const expired = l.expiresAt && l.expiresAt < new Date();
    return this.transition(
      userId,
      id,
      ['PAUSED'],
      { status: expired ? 'EXPIRED' : 'ACTIVE' },
      'resumed',
    );
  }

  async renew(userId: string, id: string) {
    const { durationDays } = await this.settings.get('listings');
    const now = new Date();
    return this.transition(
      userId,
      id,
      ['ACTIVE', 'EXPIRED'],
      { status: 'ACTIVE', expiresAt: new Date(now.getTime() + durationDays * DAY), bumpedAt: now },
      'renewed',
    );
  }

  /** "Rialza": free, at most once every N days (SPEC §3.3). */
  async bump(userId: string, id: string) {
    const l = await this.own(userId, id);
    const { bumpEveryDays } = await this.settings.get('listings');
    const last = l.bumpedAt ?? l.publishedAt;
    if (last && Date.now() - last.getTime() < bumpEveryDays * DAY) {
      throw new ConflictException(
        problem('BUMP_TOO_SOON', new Date(last.getTime() + bumpEveryDays * DAY).toISOString()),
      );
    }
    return this.transition(userId, id, ['ACTIVE'], { bumpedAt: new Date() }, 'bumped');
  }

  markSold(userId: string, id: string) {
    return this.transition(
      userId,
      id,
      ['ACTIVE', 'PAUSED'],
      { status: 'SOLD', soldAt: new Date() },
      'sold',
    );
  }

  async remove(userId: string, id: string): Promise<void> {
    const l = await this.own(userId, id);
    if (l.status === 'RESERVED')
      throw new ConflictException(problem('LISTING_INVALID_STATE', 'RESERVED → removed'));
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: { status: 'REMOVED', deletedAt: new Date() },
      });
      await writeOutbox(tx, {
        aggregateType: 'Listing',
        aggregateId: id,
        type: 'listing.removed',
        payload: { listingId: id },
      });
    });
  }

  // ───────────── Reads ─────────────

  /** Owner check with a uniform 404 (anti-IDOR). */
  async own(userId: string, id: string): Promise<ListingWithDetail> {
    const l = await this.db.listing.findFirst({
      where: { id, sellerId: userId, deletedAt: null },
      include: detailInclude,
    });
    if (!l) throw new NotFoundException();
    return l;
  }

  async detail(idOrShortId: string, viewerId: string | null): Promise<ListingDetail> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrShortId);
    const l = await this.db.listing.findFirst({
      where: {
        ...(isUuid ? { id: idOrShortId } : { shortId: idOrShortId.toUpperCase() }),
        deletedAt: null,
      },
      include: detailInclude,
    });
    const isOwner = !!l && l.sellerId === viewerId;
    if (!l || (!isOwner && !PUBLIC.includes(l.status))) throw new NotFoundException();
    if (!isOwner && l.status === 'ACTIVE') {
      void this.db.listing
        .update({ where: { id: l.id }, data: { viewsCount: { increment: 1 } } })
        .catch(() => undefined);
    }
    return this.toDetail(l, isOwner);
  }

  private async toDetail(l: ListingWithDetail, isOwner: boolean): Promise<ListingDetail> {
    const defs = attributeDefs(l.category);
    const raw = (l.attributes ?? {}) as Record<string, unknown>;
    const rep = l.seller.reputation;
    const { bumpEveryDays } = await this.settings.get('listings');
    const lastBump = l.bumpedAt ?? l.publishedAt;
    return {
      id: l.id,
      shortId: l.shortId,
      slug: l.slug,
      status: l.status,
      title: l.title,
      description: l.description,
      condition: l.condition,
      year: l.year,
      brand: l.brand ? { id: l.brand.id, name: l.brand.name, slug: l.brand.slug } : null,
      modelName: l.modelName,
      category: {
        id: l.category.id,
        slug: l.category.slug,
        name: l.category.name,
        department: { slug: l.category.department.slug, name: l.category.department.name },
        shippable: l.category.shippable,
        defaultParcelSize: l.category.defaultParcelSize,
      },
      attributes: defs
        .filter((d) => raw[d.key] !== undefined)
        .map((d) => ({
          key: d.key,
          label: d.label,
          value: displayValue(d, raw[d.key]),
          unit: d.unit ?? null,
          raw: raw[d.key],
        })),
      rawAttributes: raw,
      priceCents: l.priceCents,
      currency: 'EUR',
      isNegotiable: l.isNegotiable,
      acceptsTrades: l.acceptsTrades,
      protectedPaymentEnabled: l.protectedPaymentEnabled,
      shippingIntegrated: l.shippingIntegrated,
      parcelSize: l.parcelSize,
      shippingSelf: l.shippingSelf,
      selfShippingPriceCents: l.selfShippingPriceCents,
      handDeliveryEnabled: l.handDeliveryEnabled,
      location: {
        comuneId: l.comune.id,
        comune: l.comune.name,
        provincia: l.comune.provincia.name,
        provinciaSigla: l.comune.provincia.sigla,
        regione: l.comune.provincia.regione.name,
      },
      images: l.images.map((i) => ({
        id: i.id,
        key: i.storageKey,
        width: i.width,
        height: i.height,
        position: i.position,
        altText: i.altText,
        blurDataUrl: i.blurDataUrl,
        ready: i.width > 0,
      })),
      sellerType: l.shop ? 'BUSINESS' : 'PRIVATE',
      seller: {
        id: l.seller.id,
        username: l.seller.username,
        displayName: l.shop?.name ?? l.seller.name,
        memberSince: l.seller.createdAt.toISOString(),
        positivePctBps: rep?.sellerPositivePctBps ?? null,
        feedbackCount:
          (rep?.sellerPositive12m ?? 0) +
          (rep?.sellerNeutral12m ?? 0) +
          (rep?.sellerNegative12m ?? 0),
        levelKey: rep?.levelKey ?? null,
        topSeller: !!rep?.isTopSeller,
        identityVerified: !!l.seller.paymentAccount?.transfersEnabled,
        shop: l.shop
          ? {
              slug: l.shop.slug,
              name: l.shop.name,
              legalName: l.shop.legalName,
              vatNumber: l.shop.vatNumber,
              address: `${l.shop.addressLine}, ${l.shop.cap}`,
              verified: l.shop.isVerified,
            }
          : null,
      },
      publishedAt: l.publishedAt?.toISOString() ?? null,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      bumpedAt: l.bumpedAt?.toISOString() ?? null,
      soldAt: l.soldAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
      owner: isOwner
        ? {
            viewsCount: l.viewsCount,
            favoritesCount: l.favoritesCount,
            rejectionReason: l.rejectionReason,
            canBumpAt: lastBump
              ? new Date(lastBump.getTime() + bumpEveryDays * DAY).toISOString()
              : null,
          }
        : null,
    };
  }

  async mine(userId: string, status?: ListingStatus): Promise<MyListingItem[]> {
    const rows = await this.db.listing.findMany({
      where: { sellerId: userId, deletedAt: null, ...(status ? { status } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      include: { images: { orderBy: { position: 'asc' }, take: 1 } },
    });
    return rows.map((l) => ({
      id: l.id,
      shortId: l.shortId,
      slug: l.slug,
      title: l.title,
      status: l.status,
      priceCents: l.priceCents,
      imageKey: l.images[0]?.width ? l.images[0].storageKey : null,
      viewsCount: l.viewsCount,
      favoritesCount: l.favoritesCount,
      publishedAt: l.publishedAt?.toISOString() ?? null,
      expiresAt: l.expiresAt?.toISOString() ?? null,
      updatedAt: l.updatedAt.toISOString(),
    }));
  }

  async similar(idOrShortId: string): Promise<ListingCardItem[]> {
    const base = await this.db.listing.findFirst({
      where: /^[0-9a-f-]{36}$/i.test(idOrShortId)
        ? { id: idOrShortId }
        : { shortId: idOrShortId.toUpperCase() },
      select: { id: true, categoryId: true, brandId: true, priceCents: true },
    });
    if (!base) throw new NotFoundException();
    const rows = await this.db.listing.findMany({
      where: {
        categoryId: base.categoryId,
        status: 'ACTIVE',
        deletedAt: null,
        id: { not: base.id },
      },
      orderBy: [{ bumpedAt: 'desc' }],
      take: 8,
      include: {
        comune: { include: { provincia: true } },
        images: { orderBy: { position: 'asc' }, take: 1 },
      },
    });
    return rows.map((l) => ({
      id: l.id,
      shortId: l.shortId,
      slug: l.slug,
      title: l.title,
      priceCents: l.priceCents,
      currency: 'EUR',
      condition: l.condition,
      location: { comune: l.comune.name, provinciaSigla: l.comune.provincia.sigla },
      publishedAt: l.publishedAt?.toISOString() ?? null,
      imageKey: l.images[0]?.width ? l.images[0].storageKey : null,
    }));
  }
}
