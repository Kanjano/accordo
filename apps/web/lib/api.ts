import { type ApiClient, ApiError, createApiClient } from '@accordo/sdk';

/** Browser-side API client: the session cookie travels with `credentials: include`. */
export const api: ApiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
});

export function problemCode(error: unknown): string | null {
  if (error instanceof ApiError) return error.problem?.code ?? null;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code;
  return null;
}

export { ApiError };
