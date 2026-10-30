import { createHmac } from 'node:crypto';
import { expect } from '@playwright/test';

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
