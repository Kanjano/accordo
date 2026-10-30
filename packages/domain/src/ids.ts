import { randomInt } from 'node:crypto';

/** Crockford base32 (no I, L, O, U). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCrockford(length: number, rand: (max: number) => number = randomInt): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CROCKFORD_ALPHABET[rand(32)];
  return out;
}

/** Listing short id: 8 random Crockford characters (SPEC §10.3). */
export function generateShortId(rand?: (max: number) => number): string {
  return randomCrockford(8, rand);
}

/** Order number: 2-digit year (Europe/Rome) + "-" + 6 Crockford characters, e.g. 26-4F7K9Q. */
export function generateOrderNumber(
  now: Date = new Date(),
  rand?: (max: number) => number,
): string {
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Rome', year: '2-digit' }).format(
    now,
  );
  return `${year}-${randomCrockford(6, rand)}`;
}

export function slugify(text: string, maxLength = 80): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** URL path segment of a listing: /annuncio/{slug}-{shortId}. */
export function listingPathSegment(slug: string, shortId: string): string {
  return slug ? `${slug}-${shortId}` : shortId;
}

/** Inverse of listingPathSegment: the short id is always the last 8 characters. */
export function parseListingPathSegment(segment: string): { slug: string; shortId: string } | null {
  const match = /^(?:(.*)-)?([0-9A-HJKMNP-TV-Z]{8})$/.exec(segment);
  if (!match?.[2]) return null;
  return { slug: match[1] ?? '', shortId: match[2] };
}
