import { createHmac } from 'node:crypto';
import { type BrowserContext, expect } from '@playwright/test';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const API = process.env.API_URL ?? 'http://localhost:4000';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from a base32 secret. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const offset = (h[h.length - 1] as number) & 0xf;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/** Waits for the latest email to `to` in Mailpit and returns its HTML. */
export async function latestEmailHtml(to: string): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        id = ((await res.json()) as { messages: Array<{ ID: string }> }).messages[0]?.ID;
        return id;
      },
      { timeout: 20_000 },
    )
    .toBeTruthy();
  const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML: string };
  return msg.HTML;
}

export async function waitForApi(): Promise<void> {
  await expect
    .poll(async () => (await fetch(`${API}/health/live`).catch(() => null))?.status, {
      timeout: 120_000,
    })
    .toBe(200);
}

/** Stores a "reject optional cookies" choice so the consent banner does not cover the page. */
export async function rejectCookies(
  context: BrowserContext,
  baseURL = 'http://localhost:3000',
): Promise<void> {
  const value = encodeURIComponent(
    JSON.stringify({ v: 1, analytics: false, at: new Date().toISOString() }),
  );
  await context.addCookies([{ name: 'accordo_consent', value, url: baseURL }]);
}

/** Signs a context in through the API (the session cookie is shared by web and API). */
export async function signIn(context: BrowserContext, email: string): Promise<void> {
  await rejectCookies(context);
  const res = await context.request.post(`${API}/api/auth/sign-in/email`, {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: 'accordo-demo-2026' },
  });
  expect(res.ok()).toBe(true);
}

/** Satisfies step-up for the context (new device → emailed code read from Mailpit). */
export async function stepUp(context: BrowserContext, email: string): Promise<void> {
  const since = Date.now();
  const headers = { origin: 'http://localhost:3000' };
  await context.request.post(`${API}/api/v1/auth/step-up/email-code`, { headers });
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
        );
        const { messages } = (await res.json()) as {
          messages: Array<{ Subject: string; Created: string }>;
        };
        const m = messages.find(
          (x) => Date.parse(x.Created) >= since - 1000 && /è il tuo codice/.test(x.Subject),
        );
        code = m ? /(\d{6})/.exec(m.Subject)?.[1] : undefined;
        return code;
      },
      { timeout: 20_000 },
    )
    .toBeTruthy();
  const ok = await context.request.post(`${API}/api/v1/auth/step-up`, {
    headers,
    data: { emailCode: code },
  });
  expect(ok.ok()).toBe(true);
}
