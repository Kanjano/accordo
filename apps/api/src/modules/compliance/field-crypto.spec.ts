import { describe, expect, it } from 'vitest';
import { FieldCrypto } from './field-crypto.js';

const crypto = new FieldCrypto(Buffer.alloc(32, 1).toString('base64'), 'k1');

describe('FieldCrypto', () => {
  it('round-trips with a random IV and the key id', () => {
    const a = crypto.encrypt('RSSMRA80A01H501U');
    expect(a).not.toContain('RSSMRA');
    expect(a.startsWith('k1:')).toBe(true);
    expect(crypto.encrypt('RSSMRA80A01H501U')).not.toBe(a);
    expect(crypto.decrypt(a)).toBe('RSSMRA80A01H501U');
  });

  it('rejects tampering and unknown keys', () => {
    const [id, iv, tag, ct] = crypto.encrypt('IT60X0542811101000000123456').split(':');
    const flipped = `${(ct as string).slice(0, -2)}AA`;
    expect(() => crypto.decrypt([id, iv, tag, flipped].join(':'))).toThrow();
    expect(() => crypto.decrypt(['k2', iv, tag, ct].join(':'))).toThrow();
  });

  it('blind index is stable and case-insensitive', () => {
    expect(crypto.blindIndex('rssmra80a01h501u')).toBe(crypto.blindIndex(' RSSMRA80A01H501U'));
    expect(crypto.blindIndex('RSSMRA80A01H501U')).not.toBe(crypto.blindIndex('RSSMRA80A01H501V'));
  });
});
