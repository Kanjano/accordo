/** Cookie consent per the Garante guidelines (SPEC §14.5): no pre-ticked boxes, X = no consent, re-ask after 6 months. */
export const CONSENT_COOKIE = 'accordo_consent';
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_SECONDS = 182 * 24 * 3600;
export const CONSENT_CHANGED_EVENT = 'accordo:consent-changed';
export const CONSENT_OPEN_EVENT = 'accordo:consent-open';

export interface Consent {
  v: number;
  analytics: boolean;
  at: string;
}

export function readCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** A stored choice is valid only for the current version and for six months. */
export function parseConsent(raw: string | null, now = new Date()): Consent | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<Consent>;
    if (c.v !== CONSENT_VERSION || typeof c.analytics !== 'boolean' || typeof c.at !== 'string')
      return null;
    const age = now.getTime() - Date.parse(c.at);
    if (Number.isNaN(age) || age > CONSENT_MAX_AGE_SECONDS * 1000) return null;
    return c as Consent;
  } catch {
    return null;
  }
}

export function serializeConsent(analytics: boolean, now = new Date()): string {
  const value: Consent = { v: CONSENT_VERSION, analytics, at: now.toISOString() };
  return `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

export function analyticsAllowed(cookieHeader: string, now = new Date()): boolean {
  return parseConsent(readCookieValue(cookieHeader, CONSENT_COOKIE), now)?.analytics === true;
}
