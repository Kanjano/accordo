import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@accordo/db';
import { isValidPartitaIva, slugify } from '@accordo/domain';
import type {
  AdminShopItem,
  MyShop,
  ShopApply,
  ShopDirectoryItem,
  ShopPublic,
  ShopStatus,
  ShopUpdate,
} from '@accordo/shared';
import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { PRISMA, S3 } from '../platform/infra.providers.js';
import { writeOutbox } from '../platform/outbox.js';

const shopInclude = {
  comune: { include: { provincia: { include: { regione: true } } } },
} satisfies Prisma.ShopInclude;
type ShopRow = Prisma.ShopGetPayload<{ include: typeof shopInclude }>;

/** Legal data the staff verified: changing it needs support (SPEC §3.8). */
const LEGAL_FIELDS = ['legalName', 'vatNumber', 'addressLine', 'cap', 'comuneId'] as const;
const LIVE = ['ACTIVE', 'RESERVED'] as const;

const statusOf = (s: { isVerified: boolean; rejectedAt: Date | null }): ShopStatus =>
  s.isVerified ? 'VERIFIED' : s.rejectedAt ? 'REJECTED' : 'PENDING';

/** Stored as JSON: a string from the form, an object of days → hours from the seed. */
const hoursText = (v: Prisma.JsonValue | null): string | null =>
  v == null
    ? null
    : typeof v === 'string'
      ? v
      : Object.entries(v as Record<string, string>)
          .map(([d, h]) => `${d}: ${h}`)
          .join('\n');

const address = (s: ShopRow) =>
  `${s.addressLine}, ${s.cap} ${s.comune.name} (${s.comune.provincia.sigla})`;

function toMine(s: ShopRow): MyShop {
  return {
    id: s.id,
    status: statusOf(s),
    rejectionReason: s.isVerified ? null : s.rejectionReason,
    slug: s.slug,
    name: s.name,
    legalName: s.legalName,
    vatNumber: s.vatNumber,
    reaNumber: s.reaNumber,
    pec: s.pec,
    email: s.email,
    phone: s.phone,
    website: s.website,
    addressLine: s.addressLine,
    cap: s.cap,
    comune: { id: s.comune.id, name: s.comune.name, provinciaSigla: s.comune.provincia.sigla },
    description: s.description,
    openingHours: hoursText(s.openingHours),
    returnPolicy: s.returnPolicy,
    warrantyInfo: s.warrantyInfo,
    logoKey: s.logoKey,
    coverKey: s.coverKey,
  };
}

/** SPEC §3.8, §14.2–14.3: shop applications, staff verification, directory and storefront. */
@Injectable()
export class ShopsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async own(userId: string) {
    const shop = await this.db.shop.findUnique({
      where: { ownerId: userId },
      include: shopInclude,
    });
    if (!shop) throw new NotFoundException();
    return shop;
  }

  private async checkInput(input: ShopUpdate) {
    if (input.vatNumber !== undefined && !isValidPartitaIva(input.vatNumber))
      throw new UnprocessableEntityException({ code: 'VAT_INVALID' });
    if (
      input.comuneId &&
      !(await this.db.comune.findUnique({ where: { id: input.comuneId }, select: { id: true } }))
    )
      throw new BadRequestException({ code: 'COMUNE_NOT_FOUND' });
  }

  /** Live listings carry the seller type and name in the search document. */
  private async reindex(tx: Prisma.TransactionClient, userId: string) {
    const live = await tx.listing.findMany({
      where: { sellerId: userId, status: { in: [...LIVE] }, deletedAt: null },
      select: { id: true },
    });
    if (live.length)
      await writeOutbox(
        tx,
        ...live.map((l) => ({
          aggregateType: 'Listing',
          aggregateId: l.id,
          type: 'listing.updated',
          payload: { listingId: l.id },
        })),
      );
  }

  async mine(userId: string): Promise<MyShop> {
    return toMine(await this.own(userId));
  }

  /**
   * The application is the DSA trader self-certification: from now on the user's listings say
   * "Venditore professionale" with the legal data; staff verification adds the badge (ADR-0045).
   */
  async apply(userId: string, input: ShopApply): Promise<MyShop> {
    await this.checkInput(input);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { username: true, shop: { select: { id: true } } },
    });
    if (user.shop) throw new ConflictException({ code: 'SHOP_EXISTS' });
    if (!user.username) throw new ConflictException({ code: 'USERNAME_REQUIRED' });
    if (await this.db.shop.findUnique({ where: { vatNumber: input.vatNumber } }))
      throw new ConflictException({ code: 'VAT_TAKEN' });
    const comune = await this.db.comune.findUniqueOrThrow({ where: { id: input.comuneId } });
    const { traderSelfCertified: _, openingHours, ...data } = input;
    const base = slugify(`${input.name} ${comune.name}`, 70);
    const taken = await this.db.shop.count({ where: { slug: base } });
    const slug = taken ? `${base}-${randomUUID().slice(0, 6)}` : base;

    await this.db.$transaction(async (tx) => {
      const shop = await tx.shop.create({
        data: {
          ...data,
          slug,
          ownerId: userId,
          openingHours: openingHours ?? undefined,
          traderSelfCertifiedAt: new Date(),
        },
      });
      await tx.user.update({ where: { id: userId }, data: { accountType: 'BUSINESS' } });
      await tx.listing.updateMany({
        where: { sellerId: userId, deletedAt: null },
        data: { shopId: shop.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'shop.applied',
          entityType: 'Shop',
          entityId: shop.id,
          metadata: { vatNumber: input.vatNumber, legalName: input.legalName },
        },
      });
      await this.reindex(tx, userId);
    });
    return this.mine(userId);
  }

  async update(userId: string, input: ShopUpdate): Promise<MyShop> {
    const shop = await this.own(userId);
    await this.checkInput(input);
    const legalChanged = LEGAL_FIELDS.some((k) => input[k] !== undefined && input[k] !== shop[k]);
    if (shop.isVerified && legalChanged) throw new ConflictException({ code: 'SHOP_LEGAL_LOCKED' });
    if (input.vatNumber && input.vatNumber !== shop.vatNumber) {
      const other = await this.db.shop.findUnique({ where: { vatNumber: input.vatNumber } });
      if (other) throw new ConflictException({ code: 'VAT_TAKEN' });
    }
    const { openingHours, ...data } = input;
    await this.db.$transaction(async (tx) => {
      await tx.shop.update({
        where: { id: shop.id },
        data: {
          ...data,
          ...(openingHours !== undefined ? { openingHours: openingHours ?? Prisma.DbNull } : {}),
          // Corrected after a rejection: back in the staff queue.
          ...(shop.rejectedAt ? { rejectedAt: null, rejectionReason: null } : {}),
        },
      });
      if (input.name && input.name !== shop.name) await this.reindex(tx, userId);
    });
    return this.mine(userId);
  }

  /** Logo or cover: processed by the worker like listing photos (EXIF removed, WebP variants). */
  async media(userId: string, kind: 'logo' | 'cover', tmpKey: string): Promise<void> {
    const shop = await this.own(userId);
    if (!tmpKey.startsWith(`uploads/tmp/${userId}/`))
      throw new BadRequestException({ code: 'INVALID_UPLOAD_KEY' });
    await this.s3
      .send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET_PRIVATE, Key: tmpKey }))
      .catch(() => {
        throw new BadRequestException({ code: 'UPLOAD_NOT_FOUND' });
      });
    await this.db.$transaction((tx) =>
      writeOutbox(tx, {
        aggregateType: 'Shop',
        aggregateId: shop.id,
        type: 'media.shop_uploaded',
        payload: {
          shopId: shop.id,
          kind,
          tmpKey,
          storageKey: `shops/${shop.id}/${kind}-${randomUUID()}`,
        },
      }),
    );
  }

  // ───────────── Public ─────────────

  private readonly publicWhere = {
    isVerified: true,
    owner: { status: { not: 'DELETED' }, banned: false },
  } satisfies Prisma.ShopWhereInput;

  private async counts(ids: string[]) {
    const rows = await this.db.listing.groupBy({
      by: ['shopId'],
      where: { shopId: { in: ids }, status: 'ACTIVE', deletedAt: null },
      _count: true,
    });
    return new Map(rows.map((r) => [r.shopId, r._count]));
  }

  private toItem(s: ShopRow, counts: Map<string | null, number>): ShopDirectoryItem {
    return {
      slug: s.slug,
      name: s.name,
      logoKey: s.logoKey,
      comune: s.comune.name,
      provinciaSigla: s.comune.provincia.sigla,
      regione: s.comune.provincia.regione.name,
      activeListings: counts.get(s.id) ?? 0,
    };
  }

  async directory(q: { region?: string; q?: string; page?: number }) {
    const PER_PAGE = 24;
    const page = Math.max(1, Math.min(q.page ?? 1, 100));
    const where: Prisma.ShopWhereInput = {
      ...this.publicWhere,
      ...(q.region ? { comune: { provincia: { regione: { slug: q.region } } } } : {}),
      ...(q.q?.trim() ? { name: { contains: q.q.trim().slice(0, 80), mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.shop.findMany({
        where,
        include: shopInclude,
        orderBy: { name: 'asc' },
        skip: (page - 1) * PER_PAGE,
        take: PER_PAGE,
      }),
      this.db.shop.count({ where }),
    ]);
    const counts = await this.counts(rows.map((r) => r.id));
    return { items: rows.map((r) => this.toItem(r, counts)), total, page, perPage: PER_PAGE };
  }

  async storefront(slug: string): Promise<ShopPublic> {
    const s = await this.db.shop.findFirst({
      where: { slug, ...this.publicWhere },
      include: { ...shopInclude, owner: { select: { username: true } } },
    });
    if (!s) throw new NotFoundException();
    const counts = await this.counts([s.id]);
    return {
      ...this.toItem(s, counts),
      id: s.id,
      ownerUsername: s.owner.username,
      description: s.description,
      openingHours: hoursText(s.openingHours),
      website: s.website,
      coverKey: s.coverKey,
      verifiedAt: s.verifiedAt?.toISOString() ?? null,
      legal: {
        legalName: s.legalName,
        vatNumber: s.vatNumber,
        reaNumber: s.reaNumber,
        address: address(s),
        email: s.email,
        phone: s.phone,
        pec: s.pec,
        returnPolicy: s.returnPolicy,
        warrantyInfo: s.warrantyInfo,
      },
    };
  }

  // ───────────── Staff ─────────────

  async adminList(status: ShopStatus = 'PENDING'): Promise<AdminShopItem[]> {
    const rows = await this.db.shop.findMany({
      where:
        status === 'VERIFIED'
          ? { isVerified: true }
          : status === 'REJECTED'
            ? { isVerified: false, rejectedAt: { not: null } }
            : { isVerified: false, rejectedAt: null },
      include: { ...shopInclude, owner: { select: { id: true, email: true, username: true } } },
      orderBy: { updatedAt: 'asc' },
      take: 200,
    });
    return rows.map((s) => ({
      ...toMine(s),
      owner: s.owner,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  private async decide(staffId: string, id: string, verify: boolean, reason?: string) {
    const shop = await this.db.shop.findUnique({ where: { id } });
    if (!shop) throw new NotFoundException();
    if (shop.isVerified === verify && (verify || shop.rejectedAt))
      throw new ConflictException({ code: 'SHOP_ALREADY_DECIDED' });
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.shop.update({
        where: { id },
        data: verify
          ? { isVerified: true, verifiedAt: now, rejectedAt: null, rejectionReason: null }
          : { isVerified: false, verifiedAt: null, rejectedAt: now, rejectionReason: reason },
      });
      await tx.auditLog.create({
        data: {
          actorId: staffId,
          action: verify ? 'shop.verify' : 'shop.reject',
          entityType: 'Shop',
          entityId: id,
          metadata: reason ? { reason } : undefined,
        },
      });
      await writeOutbox(tx, {
        aggregateType: 'Shop',
        aggregateId: id,
        type: verify ? 'shop.verified' : 'shop.rejected',
        payload: { shopId: id, ownerId: shop.ownerId, reason: reason ?? null },
      });
    });
  }

  verify(staffId: string, id: string) {
    return this.decide(staffId, id, true);
  }

  reject(staffId: string, id: string, reason: string) {
    return this.decide(staffId, id, false, reason);
  }
}
