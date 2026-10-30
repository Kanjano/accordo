/** Integer division rounded half-up (non-negative operands). Money never touches floats. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError('divRoundHalfUp expects safe integers and a positive denominator');
  }
  if (numerator < 0) throw new RangeError('divRoundHalfUp expects a non-negative numerator');
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** amount × bps / 10 000, rounded half-up. */
export function applyBps(amountCents: number, bps: number): number {
  return divRoundHalfUp(amountCents * bps, 10_000);
}

export function assertCents(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer amount in cents`);
  }
}
