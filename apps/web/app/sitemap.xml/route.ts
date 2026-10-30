import { sitemapData, xml } from '@/lib/sitemap';

/** Sitemap index (SPEC §12.3). Rendered on request (never at build time); data cached an hour. */
export const dynamic = 'force-dynamic';

export async function GET() {
  const base = process.env.WEB_URL ?? 'http://localhost:3000';
  const { listingPages } = await sitemapData<{ listingPages: number }>('');
  const files = [
    'static',
    'categories',
    'brands',
    ...Array.from({ length: listingPages }, (_, i) => `listings-${i + 1}`),
  ];
  return xml(
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files
      .map((f) => `<sitemap><loc>${base}/sitemaps/${f}.xml</loc></sitemap>`)
      .join('\n')}\n</sitemapindex>`,
  );
}
