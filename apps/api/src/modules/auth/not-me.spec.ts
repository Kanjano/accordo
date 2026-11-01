import { signNotMeToken, verifyNotMeToken } from './not-me.js';

describe('not-me token', () => {
  const secret = 's'.repeat(32);
  it('round-trips, expires after 7 days and rejects tampering', () => {
    const token = signNotMeToken(secret, 'user-1', 0);
    expect(verifyNotMeToken(secret, token, 1000)).toBe('user-1');
    expect(verifyNotMeToken(secret, token, 8 * 24 * 3600 * 1000)).toBeNull();
    expect(verifyNotMeToken(secret, token.replace('user-1', 'user-2'), 1000)).toBeNull();
    expect(verifyNotMeToken('x'.repeat(32), token, 1000)).toBeNull();
    expect(verifyNotMeToken(secret, 'garbage', 1000)).toBeNull();
  });
});
