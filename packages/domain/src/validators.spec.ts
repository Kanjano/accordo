import { describe, expect, it } from 'vitest';
import { isValidCodiceFiscale, isValidPartitaIva } from './validators.js';

describe('isValidPartitaIva', () => {
  it.each(['01234567897', '00743110157', 'IT 00743110157', '12345678903'])('accepts %s', (v) => {
    expect(isValidPartitaIva(v)).toBe(true);
  });
  it.each(['01234567890', '0123456789', 'ABCDEFGHIJK', '', '123456789012'])('rejects %s', (v) => {
    expect(isValidPartitaIva(v)).toBe(false);
  });
});

describe('isValidCodiceFiscale', () => {
  it.each(['RSSMRA85T10A562S', 'rssmra85t10a562s', 'RSS MRA 85T10 A562S', 'RSSMRA85T10A56NH'])(
    'accepts %s',
    (v) => {
      expect(isValidCodiceFiscale(v)).toBe(true);
    },
  );
  it.each(['RSSMRA85T10A562T', 'RSSMRA85Z10A562S', 'RSSMRA85T10A562', '1234567890123456', ''])(
    'rejects %s',
    (v) => {
      expect(isValidCodiceFiscale(v)).toBe(false);
    },
  );
});
