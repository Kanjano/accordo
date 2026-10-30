import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from './index.js';

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

describe('createApiClient', () => {
  it('forwards cookies and throws ApiError on problem details', async () => {
    let seenCookie: string | null = null;
    const client = createApiClient({
      baseUrl: 'http://api.test',
      cookie: 'session=abc',
      fetch: (_url, init) => {
        seenCookie = new Headers(init?.headers).get('cookie');
        return json(
          { type: 'about:blank', title: 'Not found', status: 404, code: 'NOT_FOUND' },
          404,
        );
      },
    });
    await expect(client.request('/x')).rejects.toBeInstanceOf(ApiError);
    expect(seenCookie).toBe('session=abc');
  });

  it('parses a degraded health report without throwing', async () => {
    const report = { status: 'error', checks: { database: { status: 'down', error: 'refused' } } };
    const client = createApiClient({ baseUrl: 'http://api.test', fetch: () => json(report, 503) });
    await expect(client.health()).resolves.toEqual(report);
  });
});

describe('json requests', () => {
  it('serialises the body and returns undefined on 204', async () => {
    let seen: { body?: unknown; type?: string | null } = {};
    const client = createApiClient({
      baseUrl: 'http://api.test',
      fetch: (_u, init) => {
        seen = { body: init?.body, type: new Headers(init?.headers).get('content-type') };
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    });
    await expect(client.put('/x', { a: 1 })).resolves.toBeUndefined();
    expect(seen).toEqual({ body: '{"a":1}', type: 'application/json' });
  });
});
