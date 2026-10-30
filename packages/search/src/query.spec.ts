import { searchParamsSchema } from '@accordo/shared';
import { describe, expect, it } from 'vitest';
import { buildListingSearch, toSearchHit } from './query.js';
import { synonymsMap } from './settings.js';

const parse = (q: Record<string, unknown>) => searchParamsSchema.parse(q);

describe('buildListingSearch', () => {
  it('defaults to newest without text and to relevance with text', () => {
    expect(buildListingSearch(parse({})).sort).toEqual(['bumpedAt:desc']);
    expect(buildListingSearch(parse({ q: 'strato' })).sort).toEqual([]);
    expect(buildListingSearch(parse({ q: 'strato', sort: 'newest' })).sort).toEqual([
      'bumpedAt:desc',
    ]);
  });

  it('translates every URL filter', () => {
    const req = buildListingSearch(
      parse({
        department: 'chitarre',
        category: 'chitarre-elettriche',
        brand: ['fender', 'gibson'],
        condition: 'NEW,EXCELLENT',
        priceMin: '100',
        priceMax: '500',
        region: 'lombardia',
        province: 'MI',
        sellerType: 'PRIVATE',
        protectedPayment: 'true',
        shipping: '1',
        handDelivery: 'true',
        topSeller: 'true',
        yearMin: '1990',
        yearMax: '2000',
        'attr.leftHanded': 'true',
        'attr.bad key': 'x',
      }),
    );
    expect(req.filter).toEqual([
      'departmentSlug = "chitarre"',
      'categorySlug = "chitarre-elettriche"',
      'brandSlug IN ["fender", "gibson"]',
      'condition IN ["NEW", "EXCELLENT"]',
      'priceCents >= 10000',
      'priceCents <= 50000',
      'regioneSlug = "lombardia"',
      'provinciaSigla = "MI"',
      'sellerType = "PRIVATE"',
      'protectedPayment = true',
      'shippingAvailable = true',
      'handDelivery = true',
      'isTopSeller = true',
      'year >= 1990',
      'year <= 2000',
      'attr.leftHanded = "true"',
    ]);
  });

  it('uses a geo radius and distance sort when the comune centroid is known', () => {
    const geo = { lat: 45.4642, lng: 9.19 };
    const req = buildListingSearch(
      parse({ comune: '015146', radiusKm: '30', sort: 'distance' }),
      { geo, facetAttributes: ['pickupConfig'] },
      ['publishedAt > 10'],
    );
    expect(req.filter).toEqual(['publishedAt > 10', '_geoRadius(45.4642, 9.19, 30000)']);
    expect(req.sort).toEqual(['_geoPoint(45.4642, 9.19):asc']);
    expect(req.facets).toContain('attr.pickupConfig');
    // Without a radius the comune is an exact filter; without coordinates distance falls back.
    expect(buildListingSearch(parse({ comune: '015146', sort: 'distance' })).filter).toEqual([
      'comuneId = "015146"',
    ]);
    expect(buildListingSearch(parse({ sort: 'distance' })).sort).toEqual(['bumpedAt:desc']);
  });

  it('escapes quotes in attribute values', () => {
    expect(buildListingSearch(parse({ 'attr.model': 'a"b\\' })).filter).toEqual([
      'attr.model = "a\\"b\\\\"',
    ]);
  });

  it('rejects malformed parameters', () => {
    expect(searchParamsSchema.safeParse({ category: 'DROP TABLE' }).success).toBe(false);
    expect(searchParamsSchema.safeParse({ hitsPerPage: '100' }).success).toBe(false);
    expect(searchParamsSchema.safeParse({ condition: 'BROKEN' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('expands mutual synonym groups', () => {
    expect(synonymsMap([['a', 'b', 'c']])).toEqual({ a: ['b', 'c'], b: ['a', 'c'], c: ['a', 'b'] });
  });

  it('maps a document to a hit with the distance in km', () => {
    const hit = toSearchHit({
      id: 'x',
      shortId: 'ABC',
      slug: 's',
      title: 't',
      description: '',
      brand: null,
      brandSlug: null,
      model: null,
      departmentSlug: 'd',
      categorySlug: 'c',
      categoryName: 'C',
      condition: 'GOOD',
      year: null,
      priceCents: 100,
      isNegotiable: false,
      sellerType: 'PRIVATE',
      sellerId: 'u',
      sellerUsername: null,
      sellerPositivePctBps: null,
      sellerScore: 0,
      isTopSeller: false,
      protectedPayment: false,
      shippingAvailable: true,
      handDelivery: true,
      regioneSlug: 'r',
      provinciaSigla: 'MI',
      comuneId: '015146',
      comuneName: 'Milano',
      attr: {},
      imageKey: null,
      imagesCount: 0,
      status: 'ACTIVE',
      publishedAt: 1_800_000_000,
      bumpedAt: 1_800_000_000,
      _geoDistance: 12_345,
    });
    expect(hit.distanceKm).toBe(12.3);
    expect(hit.publishedAt).toBe(new Date(1_800_000_000_000).toISOString());
  });
});
