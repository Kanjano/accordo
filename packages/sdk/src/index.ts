// Types only: a value import would pull @accordo/shared (and Zod) into every page bundle.
import type { HealthReport, ProblemDetails } from '@accordo/shared';

export class ApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    readonly status: number,
  ) {
    super(problem?.title ?? `HTTP ${status}`);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Forwarded cookie header (Server Components forward the incoming request cookies). */
  cookie?: string;
  fetch?: typeof fetch;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON body; sets the content type. */
  json?: unknown;
  body?: RequestInit['body'];
}

/** ponytail: hand-written typed client over the Zod contracts (ADR-0008). */
export function createApiClient({ baseUrl, cookie, fetch: f = fetch }: ApiClientOptions) {
  async function request<T = unknown>(
    path: string,
    { json, ...init }: RequestOptions = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    if (json !== undefined) headers.set('content-type', 'application/json');
    const res = await f(new URL(path, baseUrl), {
      ...init,
      headers,
      credentials: 'include',
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    const body: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
    if (!res.ok) throw new ApiError(body as ProblemDetails, res.status);
    return body as T;
  }

  return {
    // /health/ready answers 503 with a valid report when a dependency is down: don't throw.
    async health(): Promise<HealthReport> {
      const res = await f(new URL('/health/ready', baseUrl));
      return (await res.json()) as HealthReport;
    },
    request,
    get: <T>(path: string, init?: RequestOptions) => request<T>(path, { ...init, method: 'GET' }),
    post: <T>(path: string, json?: unknown) => request<T>(path, { method: 'POST', json }),
    patch: <T>(path: string, json?: unknown) => request<T>(path, { method: 'PATCH', json }),
    put: <T>(path: string, json?: unknown) => request<T>(path, { method: 'PUT', json }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
