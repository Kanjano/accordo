import { type HealthReport, healthReportSchema, type ProblemDetails } from '@accordo/shared';

export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.title);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Forwarded cookie header (Server Components forward the incoming request cookies). */
  cookie?: string;
  fetch?: typeof fetch;
}

/** ponytail: hand-written typed client; OpenAPI generation decided later (SPEC §5.4.7). */
export function createApiClient({ baseUrl, cookie, fetch: f = fetch }: ApiClientOptions) {
  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const res = await f(new URL(path, baseUrl), { ...init, headers, credentials: 'include' });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw new ApiError(body as ProblemDetails);
    return body;
  }

  return {
    // /health/ready answers 503 with a valid report when a dependency is down: don't throw.
    async health(): Promise<HealthReport> {
      const res = await f(new URL('/health/ready', baseUrl));
      return healthReportSchema.parse(await res.json());
    },
    request,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
