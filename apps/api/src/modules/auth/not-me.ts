import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 7 * 24 * 3600 * 1000;

const mac = (secret: string, payload: string) =>
  createHmac('sha256', `not-me:${secret}`).update(payload).digest('base64url');

/** Signed, expiring token for the "Non sono stato io" link of the new-device email (SPEC §13.3). */
export function signNotMeToken(secret: string, userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + TTL_MS}`;
  return `${payload}.${mac(secret, payload)}`;
}

/** The user id, or null when the token is forged or expired. */
export function verifyNotMeToken(secret: string, token: string, now = Date.now()): string | null {
  const [userId, expires, sig] = token.split('.');
  if (!userId || !expires || !sig) return null;
  const expected = Buffer.from(mac(secret, `${userId}.${expires}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Number(expires) > now ? userId : null;
}
