/** "650", "649,90", "1.250,5", "1250.50" → integer cents; null when invalid. No floats involved. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:[,.](\d{1,2}))?$/.exec(s);
  if (!m?.[1]) return null;
  const euros = Number(m[1].replace(/\./g, ''));
  const cents = Number((m[2] ?? '').padEnd(2, '0'));
  const total = euros * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

/** Cents → editable Italian string ("649,90", "650"). */
export function centsToInput(cents: number | null | undefined): string {
  if (!cents) return '';
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest ? `${euros},${String(rest).padStart(2, '0')}` : String(euros);
}
