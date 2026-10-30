import { describe, expect, it } from 'vitest';
import {
  CROCKFORD_ALPHABET,
  generateOrderNumber,
  generateShortId,
  listingPathSegment,
  parseListingPathSegment,
  randomCrockford,
  slugify,
} from './ids.js';

describe('ids', () => {
  it('short ids are 8 Crockford characters', () => {
    for (let i = 0; i < 200; i++) expect(generateShortId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  it('uses the injected random source', () => {
    expect(randomCrockford(4, () => 31)).toBe('ZZZZ');
    expect(CROCKFORD_ALPHABET).toHaveLength(32);
  });

  it('order number uses the Europe/Rome year', () => {
    expect(generateOrderNumber(new Date('2026-12-31T23:30:00Z'), () => 0)).toBe('27-000000');
    expect(generateOrderNumber(new Date('2026-06-01T10:00:00Z'))).toMatch(
      /^26-[0-9A-HJKMNP-TV-Z]{6}$/,
    );
  });

  it('slugify', () => {
    expect(slugify('Fender Stratocaster Player 2021')).toBe('fender-stratocaster-player-2021');
    expect(slugify('  Höfner Violin Bass — "Beatle"  ')).toBe('hofner-violin-bass-beatle');
    expect(slugify('Allen & Heath QU-16')).toBe('allen-and-heath-qu-16');
    expect(slugify('Città più bella perché è così')).toBe('citta-piu-bella-perche-e-cosi');
    expect(slugify('Straße')).toBe('strasse');
    expect(slugify(`${'a'.repeat(50)} ${'b'.repeat(50)}`, 52)).toBe(`${'a'.repeat(50)}-b`);
    expect(slugify(`${'a'.repeat(10)} b`, 11)).toBe('a'.repeat(10));
  });

  it('listing path segment round-trips', () => {
    const seg = listingPathSegment('fender-stratocaster', '8K2F9Q1M');
    expect(seg).toBe('fender-stratocaster-8K2F9Q1M');
    expect(parseListingPathSegment(seg)).toEqual({
      slug: 'fender-stratocaster',
      shortId: '8K2F9Q1M',
    });
    expect(parseListingPathSegment(listingPathSegment('', '8K2F9Q1M'))).toEqual({
      slug: '',
      shortId: '8K2F9Q1M',
    });
    expect(parseListingPathSegment('no-short-id')).toBeNull();
    expect(parseListingPathSegment('bad-8K2F9Q1I')).toBeNull();
  });
});
