import { describe, expect, it } from 'vitest';
import { analyticsAllowed, CONSENT_COOKIE, parseConsent, serializeConsent } from './consent';

const cookieOf = (serialized: string) => serialized.split(';')[0] as string;

describe('cookie consent', () => {
  const now = new Date('2026-10-30T10:00:00Z');

  it('no choice → no analytics', () => {
    expect(analyticsAllowed('', now)).toBe(false);
    expect(analyticsAllowed('other=1', now)).toBe(false);
  });

  it('round-trips accept and reject', () => {
    expect(analyticsAllowed(cookieOf(serializeConsent(true, now)), now)).toBe(true);
    expect(analyticsAllowed(cookieOf(serializeConsent(false, now)), now)).toBe(false);
  });

  it('expires after six months so the banner asks again', () => {
    const later = new Date('2027-05-01T10:00:00Z');
    expect(analyticsAllowed(cookieOf(serializeConsent(true, now)), later)).toBe(false);
  });

  it('ignores malformed values and old versions', () => {
    expect(parseConsent('{nope', now)).toBeNull();
    expect(
      parseConsent(JSON.stringify({ v: 0, analytics: true, at: now.toISOString() }), now),
    ).toBeNull();
    expect(serializeConsent(true, now)).toContain(`${CONSENT_COOKIE}=`);
  });
});
