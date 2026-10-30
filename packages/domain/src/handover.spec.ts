import { describe, expect, it } from 'vitest';
import {
  generateHandoverCode,
  handoverCodeMatches,
  hashHandoverCode,
  registerHandoverAttempt,
} from './handover.js';

describe('handover code', () => {
  it('is 6 digits', () => {
    for (let i = 0; i < 100; i++) expect(generateHandoverCode()).toMatch(/^\d{6}$/);
  });

  it('is stored as an order-bound HMAC and compared in constant time', () => {
    const hash = hashHandoverCode('123456', 'order-1', 'pepper');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(handoverCodeMatches('123456', 'order-1', 'pepper', hash)).toBe(true);
    expect(handoverCodeMatches(' 123456 ', 'order-1', 'pepper', hash)).toBe(true);
    expect(handoverCodeMatches('123457', 'order-1', 'pepper', hash)).toBe(false);
    expect(handoverCodeMatches('123456', 'order-2', 'pepper', hash)).toBe(false);
    expect(handoverCodeMatches('123456', 'order-1', 'other', hash)).toBe(false);
    expect(handoverCodeMatches('123456', 'order-1', 'pepper', 'abcd')).toBe(false);
  });
});

describe('registerHandoverAttempt', () => {
  const now = new Date('2026-10-30T10:00:00Z');

  it('locks for one hour after 5 wrong attempts, then resets', () => {
    let state = { attempts: 0, lockedTill: null as Date | null };
    for (let i = 1; i <= 4; i++) {
      const r = registerHandoverAttempt(state, false, now);
      expect(r).toMatchObject({ outcome: 'WRONG_CODE', attemptsLeft: 5 - i });
      state = r.state;
    }
    const locked = registerHandoverAttempt(state, false, now);
    expect(locked.outcome).toBe('LOCKED');
    expect(locked.state.lockedTill?.toISOString()).toBe('2026-10-30T11:00:00.000Z');

    // Even the right code is refused while locked.
    expect(
      registerHandoverAttempt(locked.state, true, new Date('2026-10-30T10:59:00Z')).outcome,
    ).toBe('LOCKED');
    // After the lock the counter restarts.
    const after = registerHandoverAttempt(locked.state, false, new Date('2026-10-30T11:01:00Z'));
    expect(after).toMatchObject({ outcome: 'WRONG_CODE', attemptsLeft: 4 });
  });

  it('verifies and clears the state', () => {
    expect(registerHandoverAttempt({ attempts: 3, lockedTill: null }, true, now)).toEqual({
      outcome: 'VERIFIED',
      state: { attempts: 0, lockedTill: null },
    });
  });
});
