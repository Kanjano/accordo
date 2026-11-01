import { BUSINESS_TIMEZONE } from './business-days.js';

/**
 * Admin settings editor guard: the new value must keep the shape of the current one (same keys,
 * same value types, arrays of the same element type), so a typo can't break the platform.
 */
export function sameShape(current: unknown, next: unknown): boolean {
  const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (kind(current) !== kind(next)) return false;
  if (Array.isArray(current) && Array.isArray(next)) {
    const first = current[0];
    return first === undefined
      ? next.every((v) => kind(v) !== 'object' && kind(v) !== 'array')
      : next.every((v) => sameShape(first, v));
  }
  if (kind(current) === 'object') {
    const a = current as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length && keys.every((k) => k in b && sameShape(a[k], b[k]))
    );
  }
  return true;
}

export interface Dac7Settings {
  minActivities: number;
  maxConsiderationCents: number;
  /** Ask for the tax profile when a threshold is this close (basis points of it). */
  requestAtBps: number;
  reminderEveryDays: number;
  maxReminders: number;
  blockPayoutsWithoutProfile: boolean;
}

export interface Dac7Assessment {
  /** Reportable: 30 or more sales, or more than 2,000 € in the year (SPEC §14.4). */
  reportable: boolean;
  /** Close to a threshold: the tax profile must be requested. */
  requestProfile: boolean;
}

export function dac7Assessment(
  year: { activities: number; considerationCents: number },
  s: Dac7Settings,
): Dac7Assessment {
  const reportable =
    year.activities >= s.minActivities || year.considerationCents > s.maxConsiderationCents;
  const near =
    year.activities * 10_000 >= s.minActivities * s.requestAtBps ||
    year.considerationCents * 10_000 >= s.maxConsiderationCents * s.requestAtBps;
  return { reportable, requestProfile: reportable || near };
}

/** Calendar year and quarter (1–4) of an instant, in Italian time. */
export function yearQuarter(at: Date): { year: number; quarter: number } {
  const d = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(
    BUSINESS_TIMEZONE,
  );
  return { year: d.year, quarter: Math.ceil(d.month / 3) };
}
