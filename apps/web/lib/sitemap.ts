import type { SitemapEntry } from '@accordo/shared';

export const SITEMAP_REVALIDATE = 3600;

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function xml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}

export function urlset(base: string, entries: SitemapEntry[]): Response {
  const urls = entries
    .map(
      (e) =>
        `<url><loc>${xmlEscape(base + e.path)}</loc><lastmod>${e.lastModified}</lastmod></url>`,
    )
    .join('\n');
  return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
}

/** Fetched without cookies: the sitemaps are public and cached for an hour. */
export async function sitemapData<T>(path: string): Promise<T> {
  const res = await fetch(
    `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/seo/sitemap${path}`,
    {
      next: { revalidate: SITEMAP_REVALIDATE },
    },
  );
  if (!res.ok) throw new Error(`sitemap ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
