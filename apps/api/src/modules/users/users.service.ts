import type { Prisma, PrismaClient } from '@accordo/db';
import { ACTIVE_ORDER_STATUSES, responseTimeBucket } from '@accordo/domain';
import {
  type ActivityLevel,
  type Address,
  type AddressInput,
  isMandatoryNotification,
  type ListingCardItem,
  type MeResponse,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationPreference,
  type Page,
  type ProfileUpdate,
  type PublicProfile,
} from '@accordo/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA } from '../platform/infra.providers.js';

const DAY = 86_400_000;
const comuneSelect = {
  select: { id: true, name: true, provincia: { select: { sigla: true } } },
} as const;
const toComune = (c: { id: string; name: string; provincia: { sigla: string } } | null) =>
  c ? { id: c.id, name: c.name, provinciaSigla: c.provincia.sigla } : null;

export function activityLevel(lastSeenAt: Date | null, now = new Date()): ActivityLevel {
  if (!lastSeenAt) return null;
  const age = now.getTime() - lastSeenAt.getTime();
  return age < DAY ? 'TODAY' : age < 7 * DAY ? 'THIS_WEEK' : null;
}

const encodeCursor = (v: { at: string; id: string }) =>
  Buffer.from(JSON.stringify(v)).toString('base64url');
function decodeCursor(cursor?: string): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { at: string; id: string };
    if (typeof v.at !== 'string' || typeof v.id !== 'string' || Number.isNaN(Date.parse(v.at)))
      throw new Error();
    return v;
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR' });
  }
}

@Injectable()
export class UsersService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  // ───────────── Me ─────────────

  async me(userId: string): Promise<MeResponse> {
    const u = await this.db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { comune: comuneSelect },
    });
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      username: u.username,
      image: u.image,
      bio: u.bio,
      accountType: u.accountType,
      role: u.role,
      twoFactorEnabled: u.twoFactorEnabled,
      marketingConsent: !!u.marketingConsentAt,
      comune: toComune(u.comune),
      createdAt: u.createdAt.toISOString(),
    };
  }

  async updateMe(userId: string, input: ProfileUpdate): Promise<MeResponse> {
    const { marketingConsent, username, ...rest } = input;
    if (username) {
      const taken = await this.db.user.findFirst({
        where: { username, id: { not: userId } },
        select: { id: true },
      });
      if (taken) throw new ConflictException({ code: 'USERNAME_TAKEN' });
    }
    if (
      rest.comuneId &&
      !(await this.db.comune.findUnique({ where: { id: rest.comuneId }, select: { id: true } }))
    ) {
      throw new BadRequestException({ code: 'COMUNE_NOT_FOUND' });
    }
    await this.db.user.update({
      where: { id: userId },
      data: {
        ...rest,
        ...(username ? { username, displayUsername: username } : {}),
        ...(marketingConsent === undefined
          ? {}
          : { marketingConsentAt: marketingConsent ? new Date() : null }),
      },
    });
    return this.me(userId);
  }

  // ───────────── Addresses (always scoped by userId: anti-IDOR) ─────────────

  private toAddress(
    a: Prisma.AddressGetPayload<{ include: { comune: typeof comuneSelect } }>,
  ): Address {
    return {
      id: a.id,
      type: a.type,
      fullName: a.fullName,
      line1: a.line1,
      line2: a.line2,
      cap: a.cap,
      comuneId: a.comuneId,
      phone: a.phone,
      isDefault: a.isDefault,
      // biome-ignore lint/style/noNonNullAssertion: comune is a required relation
      comune: toComune(a.comune)!,
    };
  }

  async listAddresses(userId: string): Promise<Address[]> {
    const rows = await this.db.address.findMany({
      where: { userId },
      include: { comune: comuneSelect },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((a) => this.toAddress(a));
  }

  private async ownAddress(userId: string, id: string) {
    const address = await this.db.address.findFirst({ where: { id, userId } });
    // Same answer for "missing" and "someone else's": no information leak.
    if (!address) throw new NotFoundException();
    return address;
  }

  async createAddress(userId: string, input: AddressInput): Promise<Address> {
    await this.assertComune(input.comuneId);
    const count = await this.db.address.count({ where: { userId, type: input.type } });
    const isDefault = input.isDefault || count === 0;
    const created = await this.db.$transaction(async (tx) => {
      if (isDefault)
        await tx.address.updateMany({
          where: { userId, type: input.type },
          data: { isDefault: false },
        });
      return tx.address.create({
        data: { ...input, userId, isDefault },
        include: { comune: comuneSelect },
      });
    });
    return this.toAddress(created);
  }

  async updateAddress(userId: string, id: string, input: Partial<AddressInput>): Promise<Address> {
    const current = await this.ownAddress(userId, id);
    if (input.comuneId) await this.assertComune(input.comuneId);
    const type = input.type ?? current.type;
    const updated = await this.db.$transaction(async (tx) => {
      if (input.isDefault)
        await tx.address.updateMany({ where: { userId, type }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: input, include: { comune: comuneSelect } });
    });
    return this.toAddress(updated);
  }

  async deleteAddress(userId: string, id: string): Promise<void> {
    await this.ownAddress(userId, id);
    await this.db.address.delete({ where: { id } });
  }

  private async assertComune(id: string) {
    if (!(await this.db.comune.findUnique({ where: { id }, select: { id: true } }))) {
      throw new BadRequestException({ code: 'COMUNE_NOT_FOUND' });
    }
  }

  // ───────────── Public profile ─────────────

  private async publicUser(username: string) {
    const user = await this.db.user.findFirst({
      where: { username: username.toLowerCase(), status: { not: 'DELETED' }, banned: false },
      include: {
        comune: comuneSelect,
        reputation: true,
        paymentAccount: { select: { transfersEnabled: true } },
        shop: { select: { slug: true, name: true, isVerified: true } },
        _count: {
          select: { followers: true, listings: { where: { status: 'ACTIVE', deletedAt: null } } },
        },
      },
    });
    if (!user?.username) throw new NotFoundException();
    return user;
  }

  async publicProfile(username: string, viewerId: string | null): Promise<PublicProfile> {
    const u = await this.publicUser(username);
    const rep = u.reputation;
    const [following, blocked] = viewerId
      ? await Promise.all([
          this.db.follow.count({ where: { followerId: viewerId, followedId: u.id } }),
          this.db.userBlock.count({ where: { blockerId: viewerId, blockedId: u.id } }),
        ])
      : [0, 0];
    const comune = toComune(u.comune);
    return {
      id: u.id,
      username: u.username as string,
      displayName: u.shop?.name ?? u.name,
      image: u.image,
      bio: u.bio,
      // Only the comune, never the address (SPEC §3.1).
      location: comune ? { comune: comune.name, provinciaSigla: comune.provinciaSigla } : null,
      memberSince: u.createdAt.toISOString(),
      activity: activityLevel(u.lastSeenAt),
      responseTime: responseTimeBucket(rep?.medianResponseMinutes ?? null),
      accountType: u.accountType,
      badges: {
        emailVerified: u.emailVerified,
        identityVerified: !!u.paymentAccount?.transfersEnabled,
        shopVerified: !!u.shop?.isVerified,
        topSeller: !!rep?.isTopSeller,
        levelKey: rep?.levelKey ?? null,
      },
      reputation: {
        score: rep?.score ?? 0,
        sellerPositivePctBps: rep?.sellerPositivePctBps ?? null,
        sellerPositive12m: rep?.sellerPositive12m ?? 0,
        sellerNeutral12m: rep?.sellerNeutral12m ?? 0,
        sellerNegative12m: rep?.sellerNegative12m ?? 0,
        completedSales: rep?.completedSales ?? 0,
        completedPurchases: rep?.completedPurchases ?? 0,
      },
      shop: u.shop ? { slug: u.shop.slug, name: u.shop.name } : null,
      activeListingsCount: u._count.listings,
      followersCount: u._count.followers,
      viewer: viewerId
        ? { isFollowing: following > 0, isBlocked: blocked > 0, isSelf: viewerId === u.id }
        : null,
    };
  }

  async publicListings(
    username: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<ListingCardItem>> {
    const u = await this.publicUser(username);
    const after = decodeCursor(cursor);
    const take = Math.min(Math.max(limit, 1), 50);
    const rows = await this.db.listing.findMany({
      where: {
        sellerId: u.id,
        status: 'ACTIVE',
        deletedAt: null,
        ...(after
          ? {
              OR: [
                { bumpedAt: { lt: new Date(after.at) } },
                { bumpedAt: new Date(after.at), id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ bumpedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: { comune: comuneSelect, images: { orderBy: { position: 'asc' }, take: 1 } },
    });
    const items = rows.slice(0, take).map((l) => ({
      id: l.id,
      shortId: l.shortId,
      slug: l.slug,
      title: l.title,
      priceCents: l.priceCents,
      currency: 'EUR' as const,
      condition: l.condition,
      location: { comune: l.comune.name, provinciaSigla: l.comune.provincia.sigla },
      publishedAt: l.publishedAt?.toISOString() ?? null,
      imageKey: l.images[0]?.storageKey ?? null,
    }));
    const last = rows.length > take ? rows[take - 1] : undefined;
    return {
      items,
      nextCursor: last?.bumpedAt
        ? encodeCursor({ at: last.bumpedAt.toISOString(), id: last.id })
        : null,
    };
  }

  // ───────────── Follow / block ─────────────

  private async assertOtherUser(userId: string, targetId: string) {
    if (userId === targetId) throw new BadRequestException({ code: 'SELF_ACTION' });
    const target = await this.db.user.findFirst({
      where: { id: targetId, status: { not: 'DELETED' } },
      select: { id: true },
    });
    if (!target) throw new NotFoundException();
  }

  async follow(userId: string, targetId: string, on: boolean): Promise<void> {
    await this.assertOtherUser(userId, targetId);
    const key = { followerId: userId, followedId: targetId };
    if (on)
      await this.db.follow.upsert({
        where: { followerId_followedId: key },
        create: key,
        update: {},
      });
    else await this.db.follow.deleteMany({ where: key });
  }

  async block(userId: string, targetId: string, on: boolean): Promise<void> {
    await this.assertOtherUser(userId, targetId);
    const key = { blockerId: userId, blockedId: targetId };
    if (on) {
      await this.db.$transaction([
        this.db.userBlock.upsert({ where: { blockerId_blockedId: key }, create: key, update: {} }),
        // Blocking also stops following in both directions.
        this.db.follow.deleteMany({
          where: {
            OR: [
              { followerId: userId, followedId: targetId },
              { followerId: targetId, followedId: userId },
            ],
          },
        }),
      ]);
    } else {
      await this.db.userBlock.deleteMany({ where: key });
    }
  }

  // ───────────── Notification preferences (rows store overrides only) ─────────────

  async notificationPreferences(
    userId: string,
  ): Promise<Array<NotificationPreference & { mandatory: boolean }>> {
    const rows = await this.db.notificationPreference.findMany({ where: { userId } });
    const stored = new Map(rows.map((r) => [`${r.type}|${r.channel}`, r.enabled]));
    return NOTIFICATION_TYPES.flatMap((t) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        type: t.key,
        channel,
        mandatory: t.mandatory,
        enabled: t.mandatory || (stored.get(`${t.key}|${channel}`) ?? true),
      })),
    );
  }

  async updateNotificationPreferences(userId: string, prefs: NotificationPreference[]) {
    const editable = prefs.filter((p) => !isMandatoryNotification(p.type));
    await this.db.$transaction(
      editable.map((p) =>
        this.db.notificationPreference.upsert({
          where: { userId_type_channel: { userId, type: p.type, channel: p.channel } },
          create: { userId, ...p },
          update: { enabled: p.enabled },
        }),
      ),
    );
    return this.notificationPreferences(userId);
  }

  // ───────────── Account deletion (SPEC §10.3) ─────────────

  /**
   * Anonymises personal data and keeps orders, ledger and feedback for legal obligations.
   * Refused while the user has open orders as buyer or seller.
   */
  async deleteAccount(userId: string, meta: { ip?: string; userAgent?: string }): Promise<void> {
    const openOrders = await this.db.order.count({
      where: {
        OR: [{ buyerId: userId }, { sellerId: userId }],
        status: { in: [...ACTIVE_ORDER_STATUSES] },
      },
    });
    if (openOrders)
      throw new ConflictException({ code: 'OPEN_ORDERS', detail: `${openOrders} open orders` });

    const now = new Date();
    await this.db.$transaction([
      this.db.listing.updateMany({
        where: { sellerId: userId, deletedAt: null, status: { notIn: ['SOLD'] } },
        data: { status: 'REMOVED', deletedAt: now },
      }),
      ...[
        this.db.session,
        this.db.account,
        this.db.twoFactor,
        this.db.passkey,
        this.db.knownDevice,
        this.db.address,
        this.db.notificationPreference,
        this.db.pushSubscription,
        this.db.savedSearch,
        this.db.favorite,
        this.db.recentlyViewed,
      ].map((model) =>
        (
          model as unknown as { deleteMany: (a: object) => Prisma.PrismaPromise<unknown> }
        ).deleteMany({ where: { userId } }),
      ),
      this.db.follow.deleteMany({
        where: { OR: [{ followerId: userId }, { followedId: userId }] },
      }),
      this.db.userBlock.deleteMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      }),
      this.db.user.update({
        where: { id: userId },
        data: {
          name: 'Utente eliminato',
          email: `deleted-${userId}@deleted.invalid`,
          emailVerified: false,
          username: null,
          displayUsername: null,
          image: null,
          bio: null,
          phoneNumber: null,
          comuneId: null,
          twoFactorEnabled: false,
          marketingConsentAt: null,
          status: 'DELETED',
          deletedAt: now,
        },
      }),
      this.db.auditLog.create({
        data: {
          actorId: userId,
          actorRole: 'user',
          action: 'user.deleted',
          entityType: 'User',
          entityId: userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      }),
    ]);
  }
}
