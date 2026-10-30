import 'server-only';
import { type ApiClient, createApiClient } from '@accordo/sdk';
import { cookies, headers } from 'next/headers';

/** Server Components forward the incoming cookies to the API (SPEC §5.5). */
export async function serverApi(): Promise<ApiClient> {
  const cookie = (await cookies()).toString();
  // The visitor's address, for per-IP limits (anonymous search); trusted only behind our proxy.
  const forwardedFor = (await headers()).get('x-forwarded-for');
  return createApiClient({
    baseUrl: process.env.API_URL ?? 'http://localhost:4000',
    cookie,
    fetch: (u, i) => {
      const h = new Headers(i?.headers);
      if (forwardedFor) h.set('x-forwarded-for', forwardedFor);
      return fetch(u, { ...i, headers: h, cache: 'no-store' });
    },
  });
}

/** Public, slow-changing data (catalog, regions): shared Next.js data cache for 5 minutes. */
export function cachedApi(): ApiClient {
  return createApiClient({
    baseUrl: process.env.API_URL ?? 'http://localhost:4000',
    fetch: (u, i) => fetch(u, { ...i, next: { revalidate: 300 } }),
  });
}
