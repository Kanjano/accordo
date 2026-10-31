import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** 6-digit hand-delivery code from a CSPRNG (SPEC §6.5). */
export function generateHandoverCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * The order's code, re-derivable only with the server secret (HMAC is a cryptographic PRF), so the
 * buyer can display it again after step-up while the database keeps only its hash (ADR-0039).
 */
export function deriveHandoverCode(orderId: string, pepper: string): string {
  const n = createHmac('sha256', pepper).update(`code:${orderId}`).digest().readUInt32BE(0);
  return (n % 1_000_000).toString().padStart(6, '0');
}

/** Stored form: HMAC-SHA256(pepper, orderId:code). The code itself is never persisted. */
export function hashHandoverCode(code: string, orderId: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${orderId}:${code}`).digest('hex');
}

export function handoverCodeMatches(
  code: string,
  orderId: string,
  pepper: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashHandoverCode(code.trim(), orderId, pepper), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export const HANDOVER_MAX_ATTEMPTS = 5;
export const HANDOVER_LOCK_MS = 60 * 60 * 1000;

export interface HandoverAttemptState {
  attempts: number;
  lockedTill: Date | null;
}

export type HandoverAttemptResult =
  | { outcome: 'VERIFIED'; state: HandoverAttemptState }
  | { outcome: 'WRONG_CODE'; state: HandoverAttemptState; attemptsLeft: number }
  | { outcome: 'LOCKED'; state: HandoverAttemptState; lockedTill: Date };

/** 5 attempts, then a 1-hour lock; the counter restarts after the lock expires. */
export function registerHandoverAttempt(
  state: HandoverAttemptState,
  matched: boolean,
  now: Date,
): HandoverAttemptResult {
  if (state.lockedTill && state.lockedTill > now) {
    return { outcome: 'LOCKED', state, lockedTill: state.lockedTill };
  }
  const attempts = state.lockedTill ? 0 : state.attempts;
  if (matched) return { outcome: 'VERIFIED', state: { attempts: 0, lockedTill: null } };
  const next = attempts + 1;
  if (next >= HANDOVER_MAX_ATTEMPTS) {
    const lockedTill = new Date(now.getTime() + HANDOVER_LOCK_MS);
    return { outcome: 'LOCKED', state: { attempts: next, lockedTill }, lockedTill };
  }
  return {
    outcome: 'WRONG_CODE',
    state: { attempts: next, lockedTill: null },
    attemptsLeft: HANDOVER_MAX_ATTEMPTS - next,
  };
}
