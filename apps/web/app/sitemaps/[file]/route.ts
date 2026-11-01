import type { SitemapEntry } from '@accordo/shared';
import { LEGAL_PAGES } from '@/lib/legal';
import { sitemapData, urlset } from '@/lib/sitemap';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: RouteContext<'/sitemaps/[file]'>) {
  const base = process.env.WEB_URL ?? 'http://localhost:3000';
  const name = (await params).file.replace(/\.xml$/, '');
  if (name === 'static') {
    const now = new Date().toISOString();
    return urlset(
      base,
      [
        '/',
        '/annunci',
        '/negozi',
        '/parametri-di-classificazione',
        '/guide/imballaggio',
        '/come-funzionano-i-feedback',
        ...Object.keys(LEGAL_PAGES).map((p) => `/${p}`),
      ].map((path) => ({
        path,
        lastModified: now,
      })),
    );
  }
  if (name === 'categories' || name === 'brands' || name === 'shops')
    return urlset(base, await sitemapData<SitemapEntry[]>(`/${name}`));
  const page = /^listings-(\d+)$/.exec(name)?.[1];
  if (page) return urlset(base, await sitemapData<SitemapEntry[]>(`/listings?page=${page}`));
  return new Response('Not found', { status: 404 });
}
