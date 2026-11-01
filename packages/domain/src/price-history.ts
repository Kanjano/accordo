const DAY = 86_400_000;

export interface PricePoint {
  priceCents: number;
  changedAt: Date;
}

export interface PriceReduction {
  /** Price right before the latest cut. */
  previousCents: number;
  /** Lowest price applied in the 30 days before the cut (Omnibus reference price, SPEC §14.3). */
  lowest30dCents: number;
  reducedAt: Date;
}

/**
 * The latest price cut, while it is shown (30 days after it was made), or null.
 * `history` holds every price change, the current price being the most recent row.
 */
export function priceReduction(
  history: PricePoint[],
  now: Date,
  windowDays = 30,
): PriceReduction | null {
  // Re-publishing writes the same price again: only real changes count.
  const rows = [...history]
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
    .filter((r, i, all) => i === 0 || r.priceCents !== all[i - 1]?.priceCents);
  const current = rows.at(-1);
  const previous = rows.at(-2);
  if (!current || !previous || previous.priceCents <= current.priceCents) return null;
  const cutAt = current.changedAt.getTime();
  if (now.getTime() - cutAt > windowDays * DAY) return null;
  const from = cutAt - windowDays * DAY;
  // Prices in force during [cut - 30 days, cut): the one at the window start plus later changes.
  const before = rows.slice(0, -1);
  const atStart = before.findLast((r) => r.changedAt.getTime() <= from);
  const inWindow = before.filter((r) => r.changedAt.getTime() > from);
  const lowest30dCents = Math.min(
    ...[atStart, ...inWindow].flatMap((r) => (r ? [r.priceCents] : [])),
  );
  return { previousCents: previous.priceCents, lowest30dCents, reducedAt: current.changedAt };
}
