import 'server-only';
import { type ApiClient, createApiClient } from '@accordo/sdk';
import { cookies } from 'next/headers';

/** Server Components forward the incoming cookies to the API (SPEC §5.5). */
export async function serverApi(): Promise<ApiClient> {
  const cookie = (await cookies()).toString();
  return createApiClient({
    baseUrl: process.env.API_URL ?? 'http://localhost:4000',
    cookie,
    fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }),
  });
}
