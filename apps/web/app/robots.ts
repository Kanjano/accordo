import type { MetadataRoute } from 'next';

/** SPEC §12.3: private areas and the API stay out of the index. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.WEB_URL ?? 'http://localhost:3000';
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/admin', '/checkout', '/messaggi', '/api', '/vendi'],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
