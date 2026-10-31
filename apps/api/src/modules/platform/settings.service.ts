import type { PrismaClient } from '@accordo/db';
import type { FeeSettings, ListingCheckSettings } from '@accordo/domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PRISMA, REDIS } from './infra.providers.js';

export interface PlatformSettings {
  fees: FeeSettings;
  listings: { durationDays: number; maxImages: number; bumpEveryDays: number };
  listingChecks: ListingCheckSettings;
  bannedTerms: string[];
  parcelSizes: Record<
    'S' | 'M' | 'L' | 'XL',
    { priceCents: number; maxKg: number; dimensionsCm: number[] }
  >;
  feedback: { windowDays: number; minOrderCents: number };
  feedbackInsults: string[];
  offers: {
    expiryHours: number;
    minPercent: number;
    acceptedCheckoutHours: number;
    maxActivePerBuyerAndListing: number;
  };
}

const TTL_SECONDS = 60;

/** PlatformSetting rows (editable by admins) with a short Valkey cache (SPEC §5.8). */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async get<K extends keyof PlatformSettings>(key: K): Promise<PlatformSettings[K]> {
    const cached = await this.redis.get(`settings:${key}`);
    if (cached) return JSON.parse(cached) as PlatformSettings[K];
    const row = await this.db.platformSetting.findUnique({ where: { key } });
    if (!row) throw new Error(`Missing platform setting "${key}" (run pnpm db:seed)`);
    await this.redis.set(`settings:${key}`, JSON.stringify(row.value), 'EX', TTL_SECONDS);
    return row.value as unknown as PlatformSettings[K];
  }

  /** Called by the admin editor (Phase 11) after an update. */
  async invalidate(key: keyof PlatformSettings): Promise<void> {
    await this.redis.del(`settings:${key}`);
  }
}
