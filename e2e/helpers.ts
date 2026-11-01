import { createHmac, randomInt } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { type BrowserContext, expect, type Page } from '@playwright/test';

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

/** A new buyer (so the pair has no history and the feedback counts, fresh history: feedback counts, anti-fraud limits don't carry over between runs). */
export async function register(page: Page) {
  const stamp = Date.now();
  const email = `e2e.fb.${stamp}@example.test`;
  await page.goto('/registrati');
  await page.getByLabel('Nome e cognome').fill('Acquirente Feedback');
  await page.getByLabel('Nome utente', { exact: true }).fill(`fb${stamp}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('una-password-molto-lunga');
  await page.getByRole('checkbox', { name: /Accetto i Termini/ }).check();
  const submit = page.getByRole('button', { name: 'Registrati' });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.click();
  await expect(page.getByText('Controlla la tua email')).toBeVisible();
  const link = /href="([^"]*verify-email[^"]*)"/
    .exec(await latestEmailHtml(email))?.[1]
    ?.replace(/&amp;/g, '&');
  await page.goto(link as string);
  await expect(page).toHaveURL(/verifica-email\?stato=ok/);
  return email;
}

/** Demo staff 2FA secret (seed, development only): Better Auth keys TOTP with its UTF-8 bytes. */
const DEMO_TOTP_SECRET = 'accordo-demo-totp-secret-2026-xx';
function base32(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...bytes].map((b) => b.toString(2).padStart(8, '0')).join('');
  return (bits.match(/.{1,5}/g) ?? [])
    .map((c) => alphabet[Number.parseInt(c.padEnd(5, '0'), 2)])
    .join('');
}

/** Staff sign-in: password, then the TOTP code (the back office requires 2FA). */
export async function signInStaff(context: BrowserContext, email: string): Promise<void> {
  await rejectCookies(context);
  const headers = { origin: 'http://localhost:3000' };
  const first = await context.request.post(`${API}/api/auth/sign-in/email`, {
    headers,
    data: { email, password: 'accordo-demo-2026' },
  });
  expect(first.ok()).toBe(true);
  expect((await first.json()).twoFactorRedirect).toBe(true);
  const res = await context.request.post(`${API}/api/auth/two-factor/verify-totp`, {
    headers,
    data: { code: totp(base32(Buffer.from(DEMO_TOTP_SECRET))) },
  });
  expect(res.ok()).toBe(true);
}

/** Polls Mailpit for an email to `to` whose HTML contains `text`. */
export async function emailContaining(to: string, text: string): Promise<string> {
  let html = '';
  await expect
    .poll(
      async () => {
        const res = await fetch(
          `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`,
        );
        for (const m of ((await res.json()) as { messages: Array<{ ID: string }> }).messages) {
          const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as {
            HTML: string;
          };
          if (msg.HTML.includes(text)) {
            html = msg.HTML;
            return true;
          }
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return html;
}

/**
 * Unique PNG photos (random 8×6 block patterns): the reused-photo check (SPEC §13.5) would rightly
 * send a listing with the same fixture photos as another seller to review.
 */
export function uniquePhotos(count: number) {
  const [w, h] = [1200, 900];
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  return Array.from({ length: count }, (_, i) => {
    const blocks = Array.from({ length: 48 }, () => [0, 0, 0].map(() => randomInt(256)));
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = blocks[Math.floor(y / 150) * 8 + Math.floor(x / 150)] as number[];
        raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
      }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const buffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    return { name: `foto-${i + 1}.png`, mimeType: 'image/png', buffer };
  });
}
