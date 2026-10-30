/** Italian VAT number (Partita IVA): 11 digits with Luhn-style check digit. */
export function isValidPartitaIva(input: string): boolean {
  const value = input.replace(/\s/g, '').replace(/^IT/i, '');
  if (!/^\d{11}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(value[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(value[10]);
}

const CF_ODD: Record<string, number> = {
  0: 1,
  1: 0,
  2: 5,
  3: 7,
  4: 9,
  5: 13,
  6: 15,
  7: 17,
  8: 19,
  9: 21,
  A: 1,
  B: 0,
  C: 5,
  D: 7,
  E: 9,
  F: 13,
  G: 15,
  H: 17,
  I: 19,
  J: 21,
  K: 2,
  L: 4,
  M: 18,
  N: 20,
  O: 11,
  P: 3,
  Q: 6,
  R: 8,
  S: 12,
  T: 14,
  U: 16,
  V: 10,
  W: 22,
  X: 25,
  Y: 24,
  Z: 23,
};

const CF_PATTERN =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;

/** Italian tax code (codice fiscale) of a natural person, omocodia variants included. */
export function isValidCodiceFiscale(input: string): boolean {
  const value = input.replace(/\s/g, '').toUpperCase();
  if (!CF_PATTERN.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = value.charAt(i);
    // 1-based odd positions use the conversion table; even positions use the plain value.
    sum += i % 2 === 0 ? (CF_ODD[ch] ?? 0) : /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === value[15];
}
