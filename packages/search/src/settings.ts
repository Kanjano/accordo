import type { Settings } from 'meilisearch';

export const INDEX = { listings: 'listings', brands: 'brands', categories: 'categories' } as const;

/** Default synonym groups (SPEC §9.2); the live list is the `searchSynonyms` platform setting. */
export const DEFAULT_SYNONYMS: string[][] = [
  ['strato', 'stratocaster'],
  ['tele', 'telecaster'],
  ['lp', 'les paul'],
  ['ampli', 'amplificatore'],
  ['synth', 'sintetizzatore'],
  ['testata', 'head'],
  ['cassa', 'cabinet'],
  ['sax', 'sassofono'],
  ['scheda audio', 'interfaccia audio'],
  ['batteria elettronica', 'e-drum'],
  ['giradischi', 'turntable'],
  ['valvolare', 'valvole', 'tube'],
  ['cuffie', 'headphones'],
  ['piano digitale', 'pianoforte digitale'],
  ['consolle', 'console'],
];

/** Italian function words: they never carry meaning in instrument titles. */
export const ITALIAN_STOP_WORDS = (
  'il lo la i gli le un uno una di da in con su per tra fra e o del dello della dei degli delle ' +
  'al allo alla ai agli alle dal dalla nel nella sul sulla che come'
).split(' ');

/** Mutual synonym groups → Meilisearch's one-way map. */
export function synonymsMap(groups: string[][]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const group of groups) {
    for (const word of group) {
      map[word] = [...new Set([...(map[word] ?? []), ...group.filter((w) => w !== word)])];
    }
  }
  return map;
}

/** SPEC §9.2 (+ `publishedAt` filterable, used by saved-search alerts). */
export function listingsSettings(synonyms: string[][]): Settings {
  return {
    searchableAttributes: ['title', 'brand', 'model', 'categoryName', 'description'],
    filterableAttributes: [
      'departmentSlug',
      'categorySlug',
      'brandSlug',
      'condition',
      'priceCents',
      'sellerType',
      'protectedPayment',
      'shippingAvailable',
      'handDelivery',
      'regioneSlug',
      'provinciaSigla',
      'comuneId',
      'year',
      'isTopSeller',
      'status',
      'sellerId',
      'publishedAt',
      '_geo',
      'attr',
    ],
    sortableAttributes: ['priceCents', 'publishedAt', 'bumpedAt', '_geo'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'bumpedAt:desc'],
    typoTolerance: { enabled: true },
    stopWords: ITALIAN_STOP_WORDS,
    synonyms: synonymsMap(synonyms),
    faceting: { maxValuesPerFacet: 100 },
    pagination: { maxTotalHits: 10_000 },
  };
}

export const brandsSettings: Settings = {
  searchableAttributes: ['name', 'aliases'],
  sortableAttributes: ['listingsCount'],
  rankingRules: ['words', 'typo', 'proximity', 'attribute', 'exactness', 'listingsCount:desc'],
};

export const categoriesSettings: Settings = {
  searchableAttributes: ['name', 'departmentName'],
};
