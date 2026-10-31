import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { italianHolidays, slugify } from '@accordo/domain';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import {
  ATTRIBUTES,
  BANNED_TERMS,
  BRANDS,
  CATEGORY_ATTRIBUTES,
  DEPARTMENTS,
} from './catalog-data.js';

interface GeoFile {
  regioni: Array<{ id: string; name: string; slug: string }>;
  province: Array<{ id: string; sigla: string; name: string; slug: string; regioneId: string }>;
  comuni: Array<{
    id: string;
    name: string;
    slug: string;
    provinciaId: string;
    codiceCatastale: string | null;
    caps: string[];
    lat: number | null;
    lng: number | null;
  }>;
}

const DATA_DIR = resolve(import.meta.dirname, '../../data');

/** Full ISTAT list when present (pnpm geo:import), otherwise the bundled provincial capitals. */
async function loadGeo(): Promise<{ geo: GeoFile; source: string }> {
  for (const file of ['comuni.json', 'capoluoghi.json']) {
    try {
      return {
        geo: JSON.parse(await readFile(resolve(DATA_DIR, file), 'utf8')) as GeoFile,
        source: file,
      };
    } catch {
      // try the next one
    }
  }
  throw new Error('No geography data: run `pnpm geo:import`');
}

export async function seedGeo(db: PrismaClient): Promise<void> {
  const { geo, source } = await loadGeo();
  await db.regione.createMany({ data: geo.regioni, skipDuplicates: true });
  await db.provincia.createMany({ data: geo.province, skipDuplicates: true });
  const comuni = geo.comuni.map(
    ({ id, name, slug, provinciaId, codiceCatastale, caps, lat, lng }) => ({
      id,
      name,
      slug,
      provinciaId,
      codiceCatastale,
      caps,
      lat,
      lng,
    }),
  );
  for (let i = 0; i < comuni.length; i += 1000) {
    await db.comune.createMany({ data: comuni.slice(i, i + 1000), skipDuplicates: true });
  }
  console.log(
    `  geografia: ${geo.regioni.length} regioni, ${geo.province.length} province, ${comuni.length} comuni (${source})`,
  );
}

export async function seedCatalog(db: PrismaClient): Promise<void> {
  for (const a of ATTRIBUTES) {
    const data = {
      label: a.label,
      type: a.type,
      unit: a.unit ?? null,
      options: (a.options ?? undefined) as Prisma.InputJsonValue | undefined,
      isFilterable: a.isFilterable ?? false,
    };
    await db.attributeDefinition.upsert({
      where: { key: a.key },
      create: { key: a.key, ...data },
      update: data,
    });
  }
  const attributeIds = new Map((await db.attributeDefinition.findMany()).map((a) => [a.key, a.id]));

  let categories = 0;
  for (const [dPos, d] of DEPARTMENTS.entries()) {
    const department = await db.department.upsert({
      where: { slug: d.slug },
      create: { slug: d.slug, name: d.name, icon: d.icon, position: dPos },
      update: { name: d.name, icon: d.icon, position: dPos },
    });
    for (const [cPos, [slug, name, parcel]] of d.categories.entries()) {
      const data = {
        name,
        position: cPos,
        shippable: parcel !== 'NS',
        defaultParcelSize: parcel === 'NS' ? null : parcel,
      };
      const category = await db.category.upsert({
        where: { departmentId_slug: { departmentId: department.id, slug } },
        create: { departmentId: department.id, slug, ...data },
        update: data,
      });
      categories++;
      for (const [aPos, key] of (CATEGORY_ATTRIBUTES[slug] ?? []).entries()) {
        const attributeId = attributeIds.get(key);
        if (!attributeId) throw new Error(`Unknown attribute ${key} for ${slug}`);
        await db.categoryAttribute.upsert({
          where: { categoryId_attributeId: { categoryId: category.id, attributeId } },
          create: { categoryId: category.id, attributeId, position: aPos },
          update: { position: aPos },
        });
      }
    }
  }

  for (const [name, aliases] of Object.entries(BRANDS)) {
    await db.brand.upsert({
      where: { name },
      create: { name, slug: slugify(name), aliases },
      update: { aliases },
    });
  }
  console.log(
    `  catalogo: ${DEPARTMENTS.length} reparti, ${categories} categorie, ${ATTRIBUTES.length} attributi, ${Object.keys(BRANDS).length} marche`,
  );
}

export async function seedHolidays(db: PrismaClient, now = new Date()): Promise<void> {
  const year = now.getFullYear();
  const rows = [year, year + 1, year + 2]
    .flatMap(italianHolidays)
    .map((h) => ({ date: new Date(`${h.date}T00:00:00Z`), name: h.name }));
  await db.holiday.createMany({ data: rows, skipDuplicates: true });
  console.log(`  festività: ${rows.length} (${year}–${year + 2})`);
}

const int = (name: string, fallback: number) => {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
};

/** Initial values from .env (SPEC §17.1); existing rows are never overwritten (admins own them). */
export function defaultPlatformSettings(): Record<string, Prisma.InputJsonValue> {
  return {
    fees: {
      buyerFeeBps: int('BUYER_FEE_BPS', 400),
      buyerFeeFixedCents: int('BUYER_FEE_FIXED_CENTS', 50),
      buyerFeeMinCents: int('BUYER_FEE_MIN_CENTS', 100),
      buyerFeeMaxCents: int('BUYER_FEE_MAX_CENTS', 2500),
      sellerCommissionBps: int('SELLER_COMMISSION_BPS', 0),
      vatRateBps: int('VAT_RATE_BPS', 2200),
    },
    orderTimings: {
      checkoutReservationMinutes: int('CHECKOUT_RESERVATION_MINUTES', 15),
      sellerShipDeadlineBusinessDays: int('SELLER_SHIP_DEADLINE_BUSINESS_DAYS', 5),
      shipReminderHoursBefore: 24,
      buyerInspectionHours: int('BUYER_INSPECTION_HOURS', 72),
      selfShippingAutoCompleteDays: int('SELF_SHIPPING_AUTO_COMPLETE_DAYS', 10),
      handoverDeadlineDays: int('HANDOVER_DEADLINE_DAYS', 7),
      disputeResponseHours: int('DISPUTE_RESPONSE_HOURS', 72),
      disputeReviewBusinessDays: int('DISPUTE_REVIEW_BUSINESS_DAYS', 5),
      returnShipDeadlineBusinessDays: int('RETURN_SHIP_DEADLINE_BUSINESS_DAYS', 5),
      returnInspectionHours: int('RETURN_INSPECTION_HOURS', 48),
      notReceivedGraceDays: 3,
      notReceivedWithoutEstimateDays: 14,
      fundsHoldAlertDays: int('FUNDS_HOLD_ALERT_DAYS', 60),
      fundsHoldMaxDays: int('FUNDS_HOLD_MAX_DAYS', 85),
    },
    offers: {
      expiryHours: int('OFFER_EXPIRY_HOURS', 48),
      minPercent: int('OFFER_MIN_PERCENT', 50),
      acceptedCheckoutHours: int('ACCEPTED_OFFER_CHECKOUT_HOURS', 24),
      maxActivePerBuyerAndListing: 3,
    },
    listings: {
      durationDays: int('LISTING_DURATION_DAYS', 60),
      maxImages: int('LISTING_MAX_IMAGES', 20),
      bumpEveryDays: 7,
    },
    feedback: {
      windowDays: int('FEEDBACK_WINDOW_DAYS', 60),
      minOrderCents: int('FEEDBACK_MIN_ORDER_CENTS', 300),
    },
    parcelSizes: {
      S: { priceCents: 590, maxKg: 2, dimensionsCm: [40, 30, 10] },
      M: { priceCents: 790, maxKg: 5, dimensionsCm: [60, 40, 20] },
      L: { priceCents: 1290, maxKg: 15, dimensionsCm: [120, 50, 20] },
      XL: { priceCents: 2490, maxKg: 30, dimensionsCm: [150, 60, 40] },
    },
    listingChecks: {
      anomalousPriceBps: 3500,
      anomalousPriceMinSamples: 20,
      newSellerDays: 30,
      newSellerReviewAboveCents: 200_000,
    },
    // SPEC §6.7, configurable (ADR-0042): who pays labels and returns in each case.
    refundPolicy: {
      chargeLabelOnSellerCancel: true,
      chargeLabelOnMutualCancel: false,
      chargeReturnLabelWhenSellerAtFault: true,
    },
    bannedTerms: BANNED_TERMS,
    featureFlags: {},
  };
}

export async function seedPlatformSettings(db: PrismaClient): Promise<void> {
  const rows = Object.entries(defaultPlatformSettings()).map(([key, value]) => ({ key, value }));
  await db.platformSetting.createMany({ data: rows, skipDuplicates: true });
  console.log(`  impostazioni: ${rows.length} chiavi`);
}
