import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Field-level encryption (SPEC §10.3): AES-256-GCM, `keyId:iv:tag:ciphertext` (base64url), so keys
 * can rotate. Blind index for lookups: HMAC-SHA256 with a key derived from the same secret.
 * ponytail: one active key; add a keyId → key map when the first rotation happens.
 */
export class FieldCrypto {
  private readonly key: Buffer;
  private readonly indexKey: Buffer;

  constructor(
    base64Key: string,
    private readonly keyId: string,
  ) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes');
    this.indexKey = Buffer.from(hkdfSync('sha256', this.key, '', 'accordo-blind-index', 32));
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [this.keyId, iv, cipher.getAuthTag(), ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join(':');
  }

  decrypt(stored: string): string {
    const [keyId, iv, tag, ct] = stored.split(':');
    if (keyId !== this.keyId || !iv || !tag || !ct) throw new Error(`Unknown key id ${keyId}`);
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  blindIndex(value: string): string {
    return createHmac('sha256', this.indexKey).update(value.trim().toUpperCase()).digest('hex');
  }
}
