// SPEC §19.6 — development-only demo data. Deterministic (fixed Faker seed); skipped if already present.

import {
  computeOrderAmounts,
  computeReputation,
  countableFeedbackIds,
  type DeliveryMethod,
  dHashFromGrayscale,
  type FeedbackRecord,
  type FeeSettings,
  fullRefundBeforeTransferEntries,
  generateOrderNumber,
  generateShortId,
  hashHandoverCode,
  holidaySet,
  isValidPartitaIva,
  italianHolidays,
  type LedgerTransactionDraft,
  type OrderEvent,
  type OrderSnapshot,
  type OrderStatus,
  partialRefundEntries,
  paymentSucceededEntries,
  processorFeeEntries,
  slugify,
  transferToSellerEntries,
  transition,
  unmetTopSellerRequirements,
  weekKey,
} from '@accordo/domain';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { fakerIT as faker } from '@faker-js/faker';
import sharp from 'sharp';
import type { ItemCondition, Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
export const DEMO_ADMIN_EMAIL = 'admin@accordo.local';
const BIG_CITIES = [
  '015146',
  '058091',
  '063049',
  '001272',
  '037006',
  '048017',
  '082053',
  '010025',
  '027042',
  '072006',
  '023091',
];

const PRICE_RANGE: Record<string, [number, number]> = {
  tastiere: [150, 3500],
  chitarre: [40, 3000],
  bassi: [80, 2500],
  'batterie-percussioni': [40, 2500],
  fiati: [80, 4000],
  'strumenti-a-corda': [60, 5000],
  recording: [40, 2500],
  live: [60, 3000],
  dj: [60, 2500],
  luci: [30, 1500],
  'dischi-didattica': [4, 120],
  merchandising: [5, 400],
};
const MODEL_WORDS = [
  'Standard',
  'Custom',
  'Deluxe',
  'Pro',
  'Classic',
  'Vintage',
  'Studio',
  'Special',
  'Artist',
  'Signature',
  'Elite',
  'Player',
];
const TITLE_SUFFIX = [
  '',
  '',
  '',
  ' con custodia',
  ' come nuovo',
  ' usato pochissimo',
  ' perfetto',
  ' con accessori',
  ' + cavi',
  ' imballo originale',
];
const DESCRIPTION_SENTENCES = [
  'Vendo per passaggio ad altro strumento.',
  'Sempre tenuto in casa, mai portato in giro.',
  'Perfettamente funzionante, provato di recente.',
  'Qualche segno d’uso sul retro, visibile in foto.',
  'Disponibile per prova di persona su appuntamento.',
  'Regolato da un liutaio pochi mesi fa.',
  'Non fumatore, nessun animale in casa.',
  'Vendo perché non lo uso più come vorrei.',
  'Incluso cavo di alimentazione originale.',
  'Ottimo per chi inizia ma anche per suonare dal vivo.',
  'Spedisco ben imballato oppure consegna a mano in zona.',
  'Prezzo leggermente trattabile, niente perditempo.',
  'Acquistato in negozio, ho ancora lo scontrino.',
  'Suono caldo e pieno, nessun problema elettrico.',
];
const CHAT_BUYER = [
  'Ciao, è ancora disponibile?',
  'Ha qualche difetto non visibile in foto?',
  'Accetti il pagamento protetto?',
  'Puoi mandarmi una foto del retro?',
  'Spedisci con la spedizione integrata?',
  'Grazie, ci penso e ti faccio sapere.',
];
const CHAT_SELLER = [
  'Sì, è ancora disponibile.',
  'Nessun difetto, funziona perfettamente.',
  'Certo, puoi comprare direttamente con il pagamento protetto.',
  'Ti ho aggiunto una foto all’annuncio.',
  'Sì, spedisco entro due giorni dal pagamento.',
  'Figurati, a disposizione.',
];
const FEEDBACK_POSITIVE = [
  'Tutto perfetto, venditore consigliatissimo!',
  'Oggetto come da descrizione, spedizione veloce.',
  'Imballo curatissimo, grazie!',
  'Ottima comunicazione, consigliato.',
  null,
  null,
];
const FEEDBACK_NEUTRAL = [
  'Oggetto corretto ma spedizione più lenta del previsto.',
  'Qualche segno in più rispetto alle foto, comunque funzionante.',
];
const FEEDBACK_NEGATIVE = [
  'Oggetto con difetti non dichiarati nella descrizione.',
  'Comunicazione difficile e imballo insufficiente.',
];
const CONDITIONS: Array<{ weight: number; value: ItemCondition }> = [
  { weight: 4, value: 'NEW' },
  { weight: 12, value: 'LIKE_NEW' },
  { weight: 35, value: 'EXCELLENT' },
  { weight: 30, value: 'GOOD' },
  { weight: 14, value: 'FAIR' },
  { weight: 5, value: 'FOR_PARTS' },
];
const IMAGE_WIDTHS = [320, 640, 1280, 2048];

type Category = Prisma.CategoryGetPayload<{
  include: { department: true; attributes: { include: { attribute: true } } };
}>;
type Comune = { id: string; name: string; lat: number | null; lng: number | null };
interface DemoUser {
  id: string;
  username: string;
  createdAt: Date;
  shopId: string | null;
  canSellProtected: boolean;
  comune: Comune;
}

const pick = <T>(items: readonly T[]): T => faker.helpers.arrayElement(items);
const chance = (p: number) => faker.number.float({ min: 0, max: 1 }) < p;
const between = (from: Date, to: Date) => faker.date.between({ from, to });
const mobilePhone = () => `3${faker.string.numeric(2)} ${faker.string.numeric(7)}`;

function partitaIva(): string {
  const base = faker.string.numeric(10);
  for (let d = 0; d < 10; d++) if (isValidPartitaIva(`${base}${d}`)) return `${base}${d}`;
  throw new Error('unreachable');
}

/** Rounded to "nice" prices (e.g. 349 €, 1 250 €). */
function demoPrice(department: string): number {
  const [min, max] = PRICE_RANGE[department] ?? [20, 1000];
  const euros = faker.number.int({ min, max });
  const step = euros < 50 ? 1 : euros < 500 ? 5 : 50;
  return Math.max(min, Math.round(euros / step) * step) * 100;
}

function attributesFor(category: Category): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { attribute: a } of category.attributes) {
    if (chance(0.15)) continue;
    const options = (a.options as Array<{ value: string }> | null) ?? [];
    if (a.type === 'ENUM' && options.length) out[a.key] = pick(options).value;
    else if (a.type === 'BOOLEAN') out[a.key] = chance(0.3);
    else if (a.type === 'NUMBER')
      out[a.key] =
        a.key === 'powerWatts'
          ? pick([15, 30, 50, 100, 300, 1000])
          : faker.number.int({ min: 1, max: 24 });
    else if (a.type === 'TEXT')
      out[a.key] = pick(['Rock', 'Jazz', 'Pop', 'Classica', 'Elettronica', 'Cantautori']);
  }
  return out;
}

// ───────────────────────────── Images ─────────────────────────────

function s3FromEnv(): { client: S3Client; bucket: string } | null {
  const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_PUBLIC } =
    process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET_PUBLIC) return null;
  return {
    bucket: S3_BUCKET_PUBLIC,
    client: new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION ?? 'auto',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    }),
  };
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Locally generated placeholder (gradient + category name): no images are taken from the web. */
function placeholderSvg(label: string, hue: number): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1536">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,28%)"/>
  </linearGradient></defs>
  <rect width="2048" height="1536" fill="url(#g)"/>
  <text x="1024" y="800" font-family="Helvetica, Arial, sans-serif" font-size="120" font-weight="700" fill="white" text-anchor="middle">${escapeXml(label)}</text>
  <text x="1024" y="920" font-family="Helvetica, Arial, sans-serif" font-size="56" fill="white" fill-opacity="0.8" text-anchor="middle">Immagine dimostrativa</text>
</svg>`);
}

interface DemoImage {
  storageKey: string;
  blurDataUrl: string;
  phash: string;
}

/** Two variants per category under demo/{category}/{n}/{width}.webp (+ 1280.jpg), shared by demo listings. */
async function generateImages(categories: Category[]): Promise<Map<string, DemoImage[]>> {
  const images = new Map<string, DemoImage[]>();
  const s3 = s3FromEnv();
  if (!s3) {
    console.warn('  immagini: S3 non configurato, annunci senza foto');
    return images;
  }
  const jobs = categories.flatMap((c, i) =>
    [0, 1].map((variant) => ({ c, variant, hue: (i * 37 + variant * 160) % 360 })),
  );
  try {
    for (let i = 0; i < jobs.length; i += 8) {
      await Promise.all(
        jobs.slice(i, i + 8).map(async ({ c, variant, hue }) => {
          const base = sharp(placeholderSvg(c.name, hue));
          const storageKey = `demo/${c.slug}/${variant}`;
          const put = (key: string, Body: Buffer, ContentType: string) =>
            s3.client.send(
              new PutObjectCommand({
                Bucket: s3.bucket,
                Key: key,
                Body,
                ContentType,
                CacheControl: 'public, max-age=31536000, immutable',
              }),
            );
          for (const width of IMAGE_WIDTHS) {
            await put(
              `${storageKey}/${width}.webp`,
              await base.clone().resize(width).webp({ quality: 78 }).toBuffer(),
              'image/webp',
            );
          }
          await put(
            `${storageKey}/1280.jpg`,
            await base.clone().resize(1280).jpeg({ quality: 82 }).toBuffer(),
            'image/jpeg',
          );
          const blur = await base.clone().resize(16).webp({ quality: 40 }).toBuffer();
          const gray = await base
            .clone()
            .resize(9, 8, { fit: 'fill' })
            .grayscale()
            .raw()
            .toBuffer();
          const list = images.get(c.id) ?? [];
          list.push({
            storageKey,
            blurDataUrl: `data:image/webp;base64,${blur.toString('base64')}`,
            phash: dHashFromGrayscale(gray),
          });
          images.set(c.id, list);
        }),
      );
    }
    console.log(`  immagini: ${jobs.length} segnaposto caricati su ${s3.bucket}`);
  } catch (e) {
    console.warn(
      `  immagini: caricamento non riuscito (${e instanceof Error ? e.message : e}), annunci senza foto`,
    );
    images.clear();
  } finally {
    s3.client.destroy();
  }
  return images;
}

// ───────────────────────────── Seed ─────────────────────────────

export async function seedDemo(db: PrismaClient, now = new Date()): Promise<void> {
  if (await db.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL } })) {
    console.log('  dati demo già presenti: salto');
    return;
  }
  faker.seed(20261030);

  const categories = await db.category.findMany({
    include: { department: true, attributes: { include: { attribute: true } } },
  });
  const brands = await db.brand.findMany();
  const comuni: Comune[] = await db.comune.findMany({
    where: { lat: { not: null } },
    select: { id: true, name: true, lat: true, lng: true },
  });
  const bigCities = comuni.filter((c) => BIG_CITIES.includes(c.id));
  const randomComune = () => (chance(0.4) && bigCities.length ? pick(bigCities) : pick(comuni));
  const settings = await db.platformSetting.findMany({
    where: { key: { in: ['fees', 'parcelSizes'] } },
  });
  const fees = settings.find((s) => s.key === 'fees')?.value as unknown as FeeSettings;
  const parcelPrices = settings.find((s) => s.key === 'parcelSizes')?.value as Record<
    string,
    { priceCents: number }
  >;
  const holidays = holidaySet(
    [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].flatMap(italianHolidays),
  );

  // ── Users: 1 admin, 1 moderator, 1 support, 10 shops, 47 private ──
  const users: DemoUser[] = [];
  const staff = [
    { username: 'admin', email: DEMO_ADMIN_EMAIL, role: 'admin', name: 'Amministratore Demo' },
    {
      username: 'moderatore',
      email: 'moderatore@accordo.local',
      role: 'moderator',
      name: 'Moderatore Demo',
    },
    {
      username: 'supporto',
      email: 'supporto@accordo.local',
      role: 'support',
      name: 'Supporto Demo',
    },
  ];
  for (const s of staff) {
    await db.user.create({
      data: {
        ...s,
        displayUsername: s.username,
        emailVerified: true,
        comuneId: '058091',
        termsAcceptedAt: now,
        createdAt: new Date(now.getTime() - 400 * DAY),
      },
    });
  }
  for (let i = 0; i < 57; i++) {
    const isShop = i < 10;
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const username = slugify(`${first}${last}${i}`, 24).replace(/-/g, '');
    const comune = randomComune();
    const createdAt = between(
      new Date(now.getTime() - 3 * 365 * DAY),
      new Date(now.getTime() - 2 * DAY),
    );
    const canSellProtected = isShop || chance(0.6);
    const user = await db.user.create({
      data: {
        name: isShop ? `${last} Strumenti Musicali` : `${first} ${last}`,
        email:
          i === 10
            ? 'utente@accordo.local'
            : i === 0
              ? 'negozio@accordo.local'
              : `${username}@demo.accordo.local`,
        emailVerified: true,
        username,
        displayUsername: username,
        accountType: isShop ? 'BUSINESS' : 'PRIVATE',
        bio: chance(0.5)
          ? faker.helpers.arrayElement([
              'Suono da vent’anni, compro e vendo strumenti.',
              'Musicista e appassionato di vintage.',
              'Collezionista di effetti a pedale.',
            ])
          : null,
        comuneId: comune.id,
        termsAcceptedAt: createdAt,
        marketingConsentAt: chance(0.3) ? createdAt : null,
        lastSeenAt: between(new Date(now.getTime() - 10 * DAY), now),
        createdAt,
        addresses: {
          create: [
            {
              type: 'SHIPPING',
              fullName: `${first} ${last}`,
              line1: faker.location.streetAddress(),
              cap: faker.string.numeric(5),
              comuneId: comune.id,
              phone: mobilePhone(),
              isDefault: true,
            },
            {
              type: 'SENDER',
              fullName: `${first} ${last}`,
              line1: faker.location.streetAddress(),
              cap: faker.string.numeric(5),
              comuneId: comune.id,
              phone: mobilePhone(),
              isDefault: true,
            },
          ],
        },
        ...(canSellProtected
          ? {
              paymentAccount: {
                create: {
                  providerAccountId: `acct_demo_${username}`,
                  transfersEnabled: true,
                  payoutsEnabled: true,
                  detailsSubmitted: true,
                },
              },
            }
          : {}),
      },
    });
    let shopId: string | null = null;
    if (isShop) {
      const shopName = `${last} Strumenti Musicali`;
      const shop = await db.shop.create({
        data: {
          ownerId: user.id,
          slug: slugify(`${shopName}-${comune.name}`),
          name: shopName,
          legalName: `${last} Musica S.r.l.`,
          vatNumber: partitaIva(),
          reaNumber: `${faker.string.alpha({ length: 2, casing: 'upper' })}-${faker.string.numeric(6)}`,
          email: `info@${slugify(last)}musica.demo`,
          phone: `0${faker.string.numeric(2)} ${faker.string.numeric(7)}`,
          addressLine: faker.location.streetAddress(),
          cap: faker.string.numeric(5),
          comuneId: comune.id,
          description: 'Negozio di strumenti musicali nuovi e usati con laboratorio interno.',
          returnPolicy: 'Recesso entro 14 giorni dalla consegna secondo il Codice del Consumo.',
          warrantyInfo: 'Garanzia legale di conformità di 24 mesi sul nuovo e 12 mesi sull’usato.',
          openingHours: { lun: '15:30-19:30', 'mar-sab': '9:30-13:00, 15:30-19:30' },
          traderSelfCertifiedAt: createdAt,
          isVerified: i < 8,
          verifiedAt: i < 8 ? createdAt : null,
        },
      });
      shopId = shop.id;
    }
    users.push({ id: user.id, username, createdAt, shopId, canSellProtected, comune });
  }
  console.log(`  utenti: ${users.length + staff.length} (10 negozi, 3 staff)`);

  const images = await generateImages(categories);

  // ── Listings ──
  const shortIds = new Set<string>();
  const sellers = [...users.slice(0, 10), ...users.slice(0, 10), ...users.slice(10)]; // shops weigh double
  const listingRows: Prisma.ListingCreateManyInput[] = [];
  const imageRows: Prisma.ListingImageCreateManyInput[] = [];
  const priceRows: Prisma.ListingPriceHistoryCreateManyInput[] = [];
  for (let i = 0; i < 2000; i++) {
    const seller = pick(sellers);
    const category = pick(categories);
    const dept = category.department.slug;
    const brand =
      ['dischi-didattica', 'merchandising'].includes(dept) || chance(0.08) ? null : pick(brands);
    const modelName = brand
      ? `${pick(MODEL_WORDS)} ${faker.number.int({ min: 1, max: 9 }) * 100}`
      : null;
    const title =
      `${brand ? `${brand.name} ${modelName}` : category.name}${pick(TITLE_SUFFIX)}`.slice(0, 120);
    let shortId = generateShortId();
    while (shortIds.has(shortId)) shortId = generateShortId();
    shortIds.add(shortId);
    const priceCents = demoPrice(dept);
    const status = faker.helpers.weightedArrayElement([
      { weight: 88, value: 'ACTIVE' as const },
      { weight: 3, value: 'PAUSED' as const },
      { weight: 2, value: 'PENDING_REVIEW' as const },
      { weight: 5, value: 'EXPIRED' as const },
      { weight: 2, value: 'DRAFT' as const },
    ]);
    const publishedAt =
      status === 'DRAFT'
        ? null
        : status === 'EXPIRED'
          ? between(new Date(now.getTime() - 200 * DAY), new Date(now.getTime() - 61 * DAY))
          : between(new Date(Math.max(seller.createdAt.getTime(), now.getTime() - 58 * DAY)), now);
    const shippable = category.shippable;
    const shippingIntegrated = shippable && chance(0.7);
    const shippingSelf = shippable && (!shippingIntegrated || chance(0.2));
    const id = crypto.randomUUID();
    const condition =
      seller.shopId && chance(0.4) ? 'NEW' : faker.helpers.weightedArrayElement(CONDITIONS);
    listingRows.push({
      id,
      shortId,
      slug: slugify(title),
      sellerId: seller.id,
      shopId: seller.shopId,
      status,
      categoryId: category.id,
      brandId: brand?.id ?? null,
      modelName,
      title,
      description: faker.helpers.arrayElements(DESCRIPTION_SENTENCES, { min: 2, max: 5 }).join(' '),
      condition,
      year: chance(0.6) ? faker.number.int({ min: 1965, max: now.getFullYear() }) : null,
      attributes: attributesFor(category) as Prisma.InputJsonValue,
      priceCents,
      isNegotiable: chance(0.5),
      acceptsTrades: chance(0.2),
      comuneId: seller.comune.id,
      lat: seller.comune.lat,
      lng: seller.comune.lng,
      protectedPaymentEnabled: seller.canSellProtected && chance(0.85),
      shippingIntegrated,
      parcelSize: shippingIntegrated ? category.defaultParcelSize : null,
      shippingSelf,
      selfShippingPriceCents: shippingSelf ? pick([500, 700, 900, 1200, 1500]) : null,
      handDeliveryEnabled: !shippable || chance(0.8),
      viewsCount: faker.number.int({ min: 0, max: 900 }),
      publishedAt,
      bumpedAt: publishedAt,
      expiresAt: publishedAt ? new Date(publishedAt.getTime() + 60 * DAY) : null,
      createdAt: publishedAt ?? between(seller.createdAt, now),
    });
    const catImages = images.get(category.id) ?? [];
    for (let p = 0; p < (catImages.length ? faker.number.int({ min: 1, max: 5 }) : 0); p++) {
      const img = catImages[p % catImages.length] as DemoImage;
      imageRows.push({
        listingId: id,
        storageKey: img.storageKey,
        width: 2048,
        height: 1536,
        position: p,
        altText: title,
        blurDataUrl: img.blurDataUrl,
        phash: img.phash,
      });
    }
    priceRows.push({
      listingId: id,
      priceCents: Math.round(priceCents * (chance(0.1) ? 1.15 : 1)),
      changedAt: publishedAt ?? now,
    });
    if (priceRows.at(-1)?.priceCents !== priceCents)
      priceRows.push({ listingId: id, priceCents, changedAt: now });
  }
  await db.listing.createMany({ data: listingRows });
  await db.listingImage.createMany({ data: imageRows });
  await db.listingPriceHistory.createMany({ data: priceRows });
  console.log(`  annunci: ${listingRows.length} (${imageRows.length} foto)`);

  // ── Orders driven through the real state machine ──
  const available = listingRows.filter((l) => l.status === 'ACTIVE' && l.protectedPaymentEnabled);
  const takeListing = (needs: 'ship' | 'hand' | 'any') => {
    const idx = available.findIndex((l) =>
      needs === 'ship'
        ? l.shippingIntegrated || l.shippingSelf
        : needs === 'hand'
          ? l.handDeliveryEnabled
          : true,
    );
    if (idx < 0) throw new Error('Not enough demo listings for orders');
    return available.splice(idx, 1)[0] as Prisma.ListingCreateManyInput;
  };
  const paths: Record<OrderStatus, Array<OrderEvent['type']>> = {
    CHECKOUT_PENDING: ['CHECKOUT_STARTED'],
    PAYMENT_FAILED: ['CHECKOUT_STARTED', 'PAYMENT_FAILED'],
    EXPIRED: ['CHECKOUT_STARTED', 'RESERVATION_EXPIRED'],
    PAID: ['CHECKOUT_STARTED', 'PAYMENT_SUCCEEDED'],
    HANDOVER_PENDING: ['CHECKOUT_STARTED', 'PAYMENT_SUCCEEDED'],
    SHIPPED: ['CHECKOUT_STARTED', 'PAYMENT_SUCCEEDED', 'SHIPMENT_CONFIRMED'],
    DELIVERED: ['CHECKOUT_STARTED', 'PAYMENT_SUCCEEDED', 'SHIPMENT_CONFIRMED', 'DELIVERED'],
    DISPUTED: [
      'CHECKOUT_STARTED',
      'PAYMENT_SUCCEEDED',
      'SHIPMENT_CONFIRMED',
      'DELIVERED',
      'DISPUTE_OPENED',
    ],
    RETURN_IN_TRANSIT: [
      'CHECKOUT_STARTED',
      'PAYMENT_SUCCEEDED',
      'SHIPMENT_CONFIRMED',
      'DELIVERED',
      'DISPUTE_OPENED',
      'RETURN_REQUIRED',
    ],
    COMPLETED: [
      'CHECKOUT_STARTED',
      'PAYMENT_SUCCEEDED',
      'SHIPMENT_CONFIRMED',
      'DELIVERED',
      'BUYER_CONFIRMED_RECEIPT',
    ],
    REFUNDED: [
      'CHECKOUT_STARTED',
      'PAYMENT_SUCCEEDED',
      'SHIPMENT_CONFIRMED',
      'DELIVERED',
      'DISPUTE_OPENED',
      'RESOLVED_FULL_REFUND',
    ],
    CANCELLED: ['CHECKOUT_STARTED', 'PAYMENT_SUCCEEDED', 'SELLER_CANCELLED'],
  };
  // Hours after the previous step; the last step lands `endAgoHours` before now so live timers stay in the future.
  const STEP_HOURS: Partial<Record<OrderEvent['type'], number>> = {
    PAYMENT_SUCCEEDED: 0.1,
    PAYMENT_FAILED: 0.1,
    RESERVATION_EXPIRED: 0.3,
    SHIPMENT_CONFIRMED: 40,
    SELLER_CANCELLED: 20,
    DELIVERED: 48,
    BUYER_CONFIRMED_RECEIPT: 20,
    DISPUTE_OPENED: 30,
    RETURN_REQUIRED: 50,
    RESOLVED_FULL_REFUND: 60,
    HANDOVER_CODE_VERIFIED: 50,
  };
  const pepper = process.env.HANDOVER_CODE_PEPPER ?? 'change_me';
  const completedOrders: Array<{
    id: string;
    buyerId: string;
    sellerId: string;
    itemPriceCents: number;
    completedAt: Date;
    deliveryMethod: DeliveryMethod;
  }> = [];
  const sellerStats = new Map<
    string,
    { sales: number; volume: number; cancellations: number; disputesLost: number }
  >();
  const stat = (id: string) => {
    let s = sellerStats.get(id);
    if (!s) {
      s = { sales: 0, volume: 0, cancellations: 0, disputesLost: 0 };
      sellerStats.set(id, s);
    }
    return s;
  };
  const purchases = new Map<string, number>();
  const buyers = users.slice(10);

  async function createOrder(target: OrderStatus, opts: { hand?: boolean; endAgoHours: number }) {
    const hand = opts.hand || target === 'HANDOVER_PENDING';
    const listing = takeListing(
      hand
        ? 'hand'
        : ['CHECKOUT_PENDING', 'PAYMENT_FAILED', 'EXPIRED'].includes(target)
          ? 'any'
          : 'ship',
    );
    const buyer = pick(buyers.filter((b) => b.id !== listing.sellerId));
    const deliveryMethod: DeliveryMethod = hand
      ? 'HAND_DELIVERY'
      : listing.shippingIntegrated
        ? 'SHIPPING_INTEGRATED'
        : listing.shippingSelf
          ? 'SHIPPING_SELF'
          : 'HAND_DELIVERY';
    const amounts = computeOrderAmounts(
      {
        itemPriceCents: listing.priceCents,
        deliveryMethod,
        integratedShippingCents: listing.parcelSize
          ? parcelPrices[listing.parcelSize]?.priceCents
          : null,
        selfShippingPriceCents: listing.selfShippingPriceCents,
      },
      fees,
    );
    let events = paths[target];
    if (hand && target === 'COMPLETED')
      events = ['CHECKOUT_STARTED', 'PAYMENT_SUCCEEDED', 'HANDOVER_CODE_VERIFIED'];
    const totalHours = events.reduce((acc, e) => acc + (STEP_HOURS[e] ?? 0), 0);
    let at = new Date(now.getTime() - (opts.endAgoHours + totalHours) * HOUR);

    const number = generateOrderNumber(at);
    const order = await db.order.create({
      data: {
        number,
        listingId: listing.id as string,
        buyerId: buyer.id,
        sellerId: listing.sellerId,
        deliveryMethod,
        listingSnapshot: {
          title: listing.title,
          priceCents: listing.priceCents,
          condition: listing.condition,
          shortId: listing.shortId,
        },
        ...amounts,
        transferGroup: `tg_${number}`,
        shippingAddress:
          deliveryMethod === 'HAND_DELIVERY'
            ? undefined
            : { fullName: buyer.username, comune: buyer.comune.name },
        createdAt: at,
      },
    });
    const snap: OrderSnapshot = { status: null, deliveryMethod, currency: 'EUR', ...amounts };
    const data: Prisma.OrderUncheckedUpdateInput = {};
    const ledger: LedgerTransactionDraft[] = [];
    let refundedCents = 0;
    let shipmentId: string | null = null;

    for (const type of events) {
      at = new Date(at.getTime() + (STEP_HOURS[type] ?? 0) * HOUR);
      const event = {
        CHECKOUT_STARTED: {
          type,
          guards: {
            listingActiveWithProtectedPayment: true,
            buyerIsSeller: false,
            buyerEmailVerified: true,
            listingHasActiveOrder: false,
          },
        },
        PAYMENT_SUCCEEDED: { type, amountCents: amounts.totalCents, currency: 'EUR' },
        SHIPMENT_CONFIRMED: {
          type,
          carrier: deliveryMethod === 'SHIPPING_SELF' ? 'Poste Italiane' : 'MOCK',
          trackingNumber: `MOCK-${faker.string.alphanumeric({ length: 10, casing: 'upper' })}`,
          estimatedDeliveryAt: new Date(at.getTime() + 3 * DAY),
        },
        DELIVERED: { type, deliveredAt: at },
        BUYER_CONFIRMED_RECEIPT: { type, stepUpVerified: true },
        DISPUTE_OPENED: { type, reason: 'NOT_AS_DESCRIBED' },
      }[type as string] ?? { type };
      const r = transition(snap, event as OrderEvent, { now: at, holidays });
      snap.status = r.to;
      Object.assign(snap, r.patch);
      // estimatedDeliveryAt belongs to the Shipment row, not the Order.
      const { estimatedDeliveryAt: _eta, ...orderPatch } = r.patch;
      Object.assign(data, orderPatch, {
        status: r.to,
        nextAction: r.timer?.action ?? null,
        nextActionAt: r.timer?.at ?? null,
      });
      await db.orderEvent.create({
        data: {
          orderId: order.id,
          fromStatus: r.from,
          toStatus: r.to,
          event: type,
          actorRole:
            type.startsWith('PAYMENT') || type === 'DELIVERED' || type.endsWith('EXPIRED')
              ? 'SYSTEM'
              : type.startsWith('RESOLVED') || type === 'RETURN_REQUIRED'
                ? 'SUPPORT'
                : type === 'SHIPMENT_CONFIRMED' ||
                    type === 'SELLER_CANCELLED' ||
                    type === 'HANDOVER_CODE_VERIFIED'
                  ? 'SELLER'
                  : 'BUYER',
          createdAt: at,
        },
      });

      for (const effect of r.effects) {
        switch (effect.type) {
          case 'CREATE_PAYMENT_INTENT':
            data.paymentIntentId = `pi_demo_${order.id.slice(-12)}`;
            break;
          case 'RECORD_PAYMENT_LEDGER':
            data.chargeId = `ch_demo_${order.id.slice(-12)}`;
            ledger.push(
              paymentSucceededEntries({ ...amounts, deliveryMethod, sellerId: listing.sellerId }),
            );
            ledger.push(processorFeeEntries(Math.round(amounts.totalCents * 0.015) + 25));
            break;
          case 'GENERATE_HANDOVER_CODE':
            data.handoverCodeHash = hashHandoverCode('123456', order.id, pepper);
            break;
          case 'CREATE_SHIPPING_LABEL':
          case 'REGISTER_TRACKING': {
            const s = await db.shipment.create({
              data: {
                orderId: order.id,
                provider: 'mock',
                carrier: effect.type === 'REGISTER_TRACKING' ? effect.carrier : 'MOCK',
                parcelSize: listing.parcelSize ?? null,
                status: 'LABEL_CREATED',
                trackingNumber:
                  effect.type === 'REGISTER_TRACKING'
                    ? effect.trackingNumber
                    : `MOCK-${faker.string.alphanumeric({ length: 10, casing: 'upper' })}`,
                createdAt: at,
              },
            });
            shipmentId = s.id;
            break;
          }
          case 'TRANSFER_TO_SELLER':
            ledger.push(transferToSellerEntries(effect.amountCents, listing.sellerId));
            Object.assign(data, {
              transferId: `tr_demo_${order.id.slice(-12)}`,
              transferredAt: at,
              payoutStatus: 'TRANSFERRED',
            });
            break;
          case 'REFUND':
            ledger.push(
              effect.includesBuyerFee
                ? fullRefundBeforeTransferEntries({
                    ...amounts,
                    deliveryMethod,
                    sellerId: listing.sellerId,
                  })
                : partialRefundEntries(effect.amountCents, listing.sellerId),
            );
            refundedCents += effect.amountCents;
            await db.refund.create({
              data: {
                orderId: order.id,
                amountCents: effect.amountCents,
                reason: type,
                includesBuyerFee: effect.includesBuyerFee,
                status: 'SUCCEEDED',
                providerRefundId: `re_demo_${order.id.slice(-10)}`,
                createdAt: at,
              },
            });
            break;
          case 'CREATE_RETURN_LABEL':
            await db.shipment.create({
              data: {
                orderId: order.id,
                direction: 'RETURN',
                provider: 'mock',
                carrier: 'MOCK',
                status: 'LABEL_CREATED',
                trackingNumber: `MOCK-R${faker.string.numeric(9)}`,
                createdAt: at,
              },
            });
            break;
          case 'COUNT_SELLER_CANCELLATION':
            stat(listing.sellerId).cancellations++;
            break;
          default:
            break;
        }
      }
      if (shipmentId && (type === 'SHIPMENT_CONFIRMED' || type === 'DELIVERED')) {
        await db.shipment.update({
          where: { id: shipmentId },
          data:
            type === 'DELIVERED'
              ? { status: 'DELIVERED', deliveredAt: at }
              : {
                  status: 'IN_TRANSIT',
                  shippedAt: at,
                  estimatedDeliveryAt: snap.estimatedDeliveryAt ?? null,
                },
        });
      }
    }

    await db.order.update({
      where: { id: order.id },
      data: { ...data, refundedCents, version: events.length },
    });
    for (const [n, tx] of ledger.entries()) {
      await db.ledgerTransaction.create({
        data: {
          orderId: order.id,
          type: tx.type,
          externalRef: `demo:${order.id}:${n}`,
          createdAt: at,
          entries: { create: tx.entries },
        },
      });
    }
    const listingStatus = ['COMPLETED'].includes(target)
      ? 'SOLD'
      : [
            'PAID',
            'HANDOVER_PENDING',
            'SHIPPED',
            'DELIVERED',
            'DISPUTED',
            'RETURN_IN_TRANSIT',
          ].includes(target)
        ? 'RESERVED'
        : 'ACTIVE';
    await db.listing.update({
      where: { id: listing.id as string },
      data: { status: listingStatus, soldAt: listingStatus === 'SOLD' ? at : null },
    });

    if (['DISPUTED', 'RETURN_IN_TRANSIT', 'REFUNDED'].includes(target)) {
      const openedAt = (
        await db.orderEvent.findFirstOrThrow({
          where: { orderId: order.id, event: 'DISPUTE_OPENED' },
        })
      ).createdAt;
      await db.dispute.create({
        data: {
          orderId: order.id,
          openedById: buyer.id,
          reason: 'NOT_AS_DESCRIBED',
          description:
            'Lo strumento ha un difetto al jack di uscita che non era indicato nella descrizione dell’annuncio.',
          status:
            target === 'DISPUTED'
              ? 'OPEN'
              : target === 'RETURN_IN_TRANSIT'
                ? 'AWAITING_RETURN'
                : 'RESOLVED',
          outcome:
            target === 'RETURN_IN_TRANSIT'
              ? 'REFUND_FULL_WITH_RETURN'
              : target === 'REFUNDED'
                ? 'REFUND_FULL'
                : null,
          sellerResponseDueAt: new Date(openedAt.getTime() + 72 * HOUR),
          resolvedAt: target === 'REFUNDED' ? at : null,
          resolutionNotes:
            target === 'REFUNDED'
              ? 'Difetto confermato dalle foto: rimborso totale senza reso.'
              : null,
          createdAt: openedAt,
          messages: {
            create: {
              authorId: buyer.id,
              authorRole: 'BUYER',
              body: 'Allego le foto del difetto.',
              createdAt: openedAt,
            },
          },
        },
      });
      if (target === 'REFUNDED') stat(listing.sellerId).disputesLost++;
    }
    if (target === 'COMPLETED') {
      completedOrders.push({
        id: order.id,
        buyerId: buyer.id,
        sellerId: listing.sellerId,
        itemPriceCents: amounts.itemPriceCents,
        completedAt: at,
        deliveryMethod,
      });
      const s = stat(listing.sellerId);
      s.sales++;
      s.volume += amounts.itemPriceCents;
      purchases.set(buyer.id, (purchases.get(buyer.id) ?? 0) + 1);
    }
  }

  // Live orders: two per state. endAgoHours keeps their sweeper timers in the future.
  const LIVE_END_AGO: Record<OrderStatus, number> = {
    CHECKOUT_PENDING: 0.05,
    PAYMENT_FAILED: 5,
    EXPIRED: 30,
    PAID: 12,
    HANDOVER_PENDING: 24,
    SHIPPED: 24,
    DELIVERED: 20,
    DISPUTED: 10,
    RETURN_IN_TRANSIT: 12,
    COMPLETED: 48,
    REFUNDED: 100,
    CANCELLED: 70,
  };
  for (const [status, endAgoHours] of Object.entries(LIVE_END_AGO) as Array<
    [OrderStatus, number]
  >) {
    for (let n = 0; n < 2; n++)
      await createOrder(status, { endAgoHours, hand: status === 'COMPLETED' && n === 1 });
  }
  // History for reputation: completed orders over the past year.
  for (let n = 0; n < 160; n++)
    await createOrder('COMPLETED', {
      endAgoHours: faker.number.int({ min: 72, max: 360 * 24 }),
      hand: chance(0.15),
    });
  console.log(`  ordini: ${24 + 160} (almeno 2 per stato), ${completedOrders.length} completati`);

  // ── Feedback (~97% positive) and reputation ──
  const feedbackRows: Array<Prisma.FeedbackCreateManyInput & { id: string }> = [];
  for (const o of completedOrders) {
    const completedWeek = weekKey(o.completedAt);
    if (chance(0.85)) {
      const rating = faker.helpers.weightedArrayElement([
        { weight: 97, value: 'POSITIVE' as const },
        { weight: 1.5, value: 'NEUTRAL' as const },
        { weight: 1.5, value: 'NEGATIVE' as const },
      ]);
      const good = rating === 'POSITIVE';
      const hand = o.deliveryMethod === 'HAND_DELIVERY';
      const star = () =>
        good
          ? faker.helpers.weightedArrayElement([
              { weight: 80, value: 5 },
              { weight: 18, value: 4 },
              { weight: 2, value: 3 },
            ])
          : faker.number.int({ min: 1, max: 3 });
      feedbackRows.push({
        id: crypto.randomUUID(),
        orderId: o.id,
        authorId: o.buyerId,
        recipientId: o.sellerId,
        role: 'BUYER_TO_SELLER',
        rating,
        comment:
          rating === 'POSITIVE'
            ? pick(FEEDBACK_POSITIVE)
            : rating === 'NEUTRAL'
              ? pick(FEEDBACK_NEUTRAL)
              : pick(FEEDBACK_NEGATIVE),
        dsrItemAsDescribed: star(),
        dsrCommunication: star(),
        dsrShippingTime: hand ? null : star(),
        dsrPackaging: hand ? null : star(),
        weekKey: completedWeek,
        createdAt: new Date(o.completedAt.getTime() + faker.number.int({ min: 1, max: 96 }) * HOUR),
      });
    }
    if (chance(0.7)) {
      feedbackRows.push({
        id: crypto.randomUUID(),
        orderId: o.id,
        authorId: o.sellerId,
        recipientId: o.buyerId,
        role: 'SELLER_TO_BUYER',
        rating: 'POSITIVE',
        comment: chance(0.5) ? 'Acquirente puntuale e cordiale, consigliato.' : null,
        weekKey: completedWeek,
        createdAt: new Date(o.completedAt.getTime() + faker.number.int({ min: 1, max: 96 }) * HOUR),
      });
    }
  }
  const records: FeedbackRecord[] = feedbackRows.map((f) => ({
    id: f.id,
    authorId: f.authorId,
    recipientId: f.recipientId,
    role: f.role,
    rating: f.rating,
    status: 'PUBLISHED',
    orderItemPriceCents: completedOrders.find((o) => o.id === f.orderId)?.itemPriceCents ?? 0,
    weekKey: f.weekKey,
    createdAt: f.createdAt as Date,
    dsrItemAsDescribed: f.dsrItemAsDescribed,
    dsrCommunication: f.dsrCommunication,
    dsrShippingTime: f.dsrShippingTime,
    dsrPackaging: f.dsrPackaging,
  }));
  const countable = countableFeedbackIds(records);
  await db.feedback.createMany({
    data: feedbackRows.map((f) => ({ ...f, countsTowardScore: countable.has(f.id) })),
  });

  const paymentAccounts = new Set(
    (await db.paymentAccount.findMany({ where: { transfersEnabled: true } })).map((p) => p.userId),
  );
  let topSellers = 0;
  for (const u of users) {
    const rep = computeReputation(
      records.filter((r) => r.recipientId === u.id),
      now,
    );
    const s = sellerStats.get(u.id) ?? { sales: 0, volume: 0, cancellations: 0, disputesLost: 0 };
    const isTopSeller =
      unmetTopSellerRequirements({
        accountAgeDays: (now.getTime() - u.createdAt.getTime()) / DAY,
        transfersEnabled: paymentAccounts.has(u.id),
        completedSales12m: s.sales,
        salesVolume12mCents: s.volume,
        sellerPositivePctBps: rep.sellerPositivePctBps,
        dsr: rep.dsr,
        disputesLost12m: s.disputesLost,
        sellerCancellations12m: s.cancellations,
        hasActiveSanction: false,
      }).length === 0;
    if (isTopSeller) topSellers++;
    await db.userReputation.create({
      data: {
        userId: u.id,
        score: rep.score,
        levelKey: rep.levelKey,
        sellerPositive12m: rep.sellerPositive12m,
        sellerNeutral12m: rep.sellerNeutral12m,
        sellerNegative12m: rep.sellerNegative12m,
        sellerPositivePctBps: rep.sellerPositivePctBps,
        buyerPositive12m: rep.buyerPositive12m,
        dsrItemAsDescribedAvg: rep.dsr.ItemAsDescribed.avg,
        dsrItemAsDescribedCount: rep.dsr.ItemAsDescribed.count,
        dsrCommunicationAvg: rep.dsr.Communication.avg,
        dsrCommunicationCount: rep.dsr.Communication.count,
        dsrShippingTimeAvg: rep.dsr.ShippingTime.avg,
        dsrShippingTimeCount: rep.dsr.ShippingTime.count,
        dsrPackagingAvg: rep.dsr.Packaging.avg,
        dsrPackagingCount: rep.dsr.Packaging.count,
        completedSales: s.sales,
        completedPurchases: purchases.get(u.id) ?? 0,
        salesVolume12mCents: BigInt(s.volume),
        disputesLost12m: s.disputesLost,
        sellerCancellations12m: s.cancellations,
        medianResponseMinutes: faker.number.int({ min: 5, max: 600 }),
        responseRateBps: faker.number.int({ min: 6000, max: 10_000 }),
        isTopSeller,
        topSellerSince: isTopSeller ? now : null,
      },
    });
  }
  console.log(`  feedback: ${feedbackRows.length}, Venditori Top: ${topSellers}`);

  // ── Conversations, offers, engagement ──
  const active = listingRows.filter((l) => l.status === 'ACTIVE');
  let conversations = 0;
  let offers = 0;
  const pairs = new Set<string>();
  for (let n = 0; n < 150; n++) {
    const listing = pick(active);
    const buyer = pick(buyers);
    if (buyer.id === listing.sellerId || pairs.has(`${listing.id}|${buyer.id}`)) continue;
    pairs.add(`${listing.id}|${buyer.id}`);
    let at = new Date(
      Math.max((listing.publishedAt as Date).getTime(), now.getTime() - 20 * DAY) + HOUR,
    );
    const count = faker.number.int({ min: 1, max: 6 });
    const messages: Prisma.MessageCreateWithoutConversationInput[] = [];
    for (let m = 0; m < count; m++) {
      at = new Date(
        Math.min(at.getTime() + faker.number.int({ min: 5, max: 600 }) * 60_000, now.getTime()),
      );
      const fromBuyer = m % 2 === 0;
      messages.push({
        sender: { connect: { id: fromBuyer ? buyer.id : listing.sellerId } },
        body: fromBuyer
          ? (CHAT_BUYER[m] ?? pick(CHAT_BUYER))
          : (CHAT_SELLER[m] ?? pick(CHAT_SELLER)),
        readAt: m < count - 1 ? at : null,
        createdAt: at,
      });
    }
    if (n === 0)
      messages.push({
        sender: { connect: { id: listing.sellerId } },
        body: 'Se preferisci fammi un bonifico su IT60 X054 2811 1010 0000 0123 456',
        flags: ['IBAN', 'OFF_PLATFORM_PAYMENT'],
        createdAt: at,
      });
    const conversation = await db.conversation.create({
      data: {
        listingId: listing.id as string,
        buyerId: buyer.id,
        sellerId: listing.sellerId,
        lastMessageAt: at,
        sellerUnread: count % 2,
        buyerUnread: count % 2 ? 0 : 1,
        createdAt: messages[0]?.createdAt ?? at,
        messages: { create: messages },
      },
    });
    conversations++;
    if (listing.isNegotiable && listing.protectedPaymentEnabled && chance(0.4)) {
      const status = faker.helpers.weightedArrayElement([
        { weight: 4, value: 'PENDING' as const },
        { weight: 3, value: 'DECLINED' as const },
        { weight: 2, value: 'EXPIRED' as const },
        { weight: 2, value: 'COUNTERED' as const },
      ]);
      const amountCents = Math.round(
        (listing.priceCents * faker.number.int({ min: 60, max: 95 })) / 100,
      );
      const createdAt = new Date(at.getTime() - HOUR);
      const offer = await db.offer.create({
        data: {
          listingId: listing.id as string,
          buyerId: buyer.id,
          sellerId: listing.sellerId,
          amountCents,
          status,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + (status === 'EXPIRED' ? -HOUR : 48 * HOUR)),
          respondedAt: status === 'PENDING' || status === 'EXPIRED' ? null : at,
        },
      });
      await db.message.create({
        data: {
          conversationId: conversation.id,
          senderId: buyer.id,
          type: 'OFFER',
          offerId: offer.id,
          body: null,
          createdAt,
        },
      });
      if (status === 'COUNTERED') {
        await db.offer.create({
          data: {
            listingId: listing.id as string,
            buyerId: buyer.id,
            sellerId: listing.sellerId,
            amountCents: Math.round((amountCents + listing.priceCents) / 2),
            parentOfferId: offer.id,
            status: 'PENDING',
            createdAt: at,
            expiresAt: new Date(at.getTime() + 48 * HOUR),
          },
        });
      }
      offers++;
    }
  }

  const favorites = new Set<string>();
  for (let n = 0; n < 600; n++) favorites.add(`${pick(buyers).id}|${pick(active).id}`);
  await db.favorite.createMany({
    data: [...favorites].map((k) => ({
      userId: k.split('|')[0] as string,
      listingId: k.split('|')[1] as string,
    })),
    skipDuplicates: true,
  });
  const follows = new Set<string>();
  for (let n = 0; n < 100; n++) {
    const a = pick(users);
    const b = pick(users);
    if (a.id !== b.id) follows.add(`${a.id}|${b.id}`);
  }
  await db.follow.createMany({
    data: [...follows].map((k) => ({
      followerId: k.split('|')[0] as string,
      followedId: k.split('|')[1] as string,
    })),
    skipDuplicates: true,
  });
  await db.savedSearch.createMany({
    data: Array.from({ length: 30 }, () => ({
      userId: pick(buyers).id,
      name: pick([
        'Stratocaster usate',
        'Synth analogici',
        'Testate valvolari',
        'Batterie elettroniche',
        'Sax contralto',
      ]),
      query: {
        q: pick([
          'stratocaster',
          'synth analogico',
          'testata valvolare',
          'batteria elettronica',
          'sax contralto',
        ]),
        sort: 'recent',
      },
      alertFrequency: pick(['INSTANT', 'DAILY', 'NONE'] as const),
    })),
  });

  await db.report.createMany({
    data: [
      {
        reporterId: pick(buyers).id,
        targetType: 'LISTING',
        targetId: pick(active).id as string,
        reasonCode: 'SUSPECTED_SCAM',
        details: 'Prezzo troppo basso e il venditore chiede il bonifico.',
        goodFaithConfirmed: true,
      },
      {
        reporterId: pick(buyers).id,
        targetType: 'USER',
        targetId: pick(users).id,
        reasonCode: 'HARASSMENT',
        details: 'Messaggi insistenti e offensivi.',
        goodFaithConfirmed: true,
      },
      {
        reporterEmail: 'segnalazione@example.com',
        reporterName: 'Visitatore',
        targetType: 'LISTING',
        targetId: pick(active).id as string,
        reasonCode: 'PROHIBITED_ITEM',
        details: 'Lo strumento sembra avere intarsi in avorio senza documentazione.',
        isIllegalContent: true,
        goodFaithConfirmed: true,
      },
    ],
  });
  console.log(
    `  conversazioni: ${conversations}, offerte: ${offers}, preferiti: ${favorites.size}, segnalazioni: 3`,
  );
}
