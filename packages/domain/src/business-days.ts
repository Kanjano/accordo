export const BUSINESS_TIMEZONE = 'Europe/Rome';

export interface Holiday {
  /** ISO calendar date, YYYY-MM-DD (Europe/Rome). */
  date: string;
  name: string;
}

/** Easter Sunday (Gregorian), Meeus/Jones/Butcher algorithm. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Temporal.PlainDate.from({ year, month, day }).toString();
}

const FIXED_HOLIDAYS: ReadonlyArray<[month: number, day: number, name: string]> = [
  [1, 1, 'Capodanno'],
  [1, 6, 'Epifania'],
  [4, 25, 'Festa della Liberazione'],
  [5, 1, 'Festa del Lavoro'],
  [6, 2, 'Festa della Repubblica'],
  [8, 15, 'Ferragosto'],
  [10, 4, "San Francesco d'Assisi"],
  [11, 1, 'Ognissanti'],
  [12, 8, 'Immacolata Concezione'],
  [12, 25, 'Natale'],
  [12, 26, 'Santo Stefano'],
];

/** Italian national holidays for a year (SPEC §19.5; 4 October is a national holiday again from 2026). */
export function italianHolidays(year: number): Holiday[] {
  const holidays = FIXED_HOLIDAYS.filter(([m, d]) => !(m === 10 && d === 4 && year < 2026)).map(
    ([month, day, name]) => ({
      date: Temporal.PlainDate.from({ year, month, day }).toString(),
      name,
    }),
  );
  const easterMonday = Temporal.PlainDate.from(easterSunday(year)).add({ days: 1 }).toString();
  holidays.push({ date: easterMonday, name: "Lunedì dell'Angelo" });
  return holidays.sort((x, y) => x.date.localeCompare(y.date));
}

function toZoned(date: Date): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(
    BUSINESS_TIMEZONE,
  );
}

/** Weekdays that are not in the holiday set, evaluated on the Europe/Rome calendar. */
export function isBusinessDay(date: Date, holidays: ReadonlySet<string>): boolean {
  const zoned = toZoned(date);
  return zoned.dayOfWeek <= 5 && !holidays.has(zoned.toPlainDate().toString());
}

/**
 * Adds business days keeping the Europe/Rome wall-clock time (DST safe).
 * "Shipping within 5 business days" from Friday 10:00 ends the following Friday 10:00.
 */
export function addBusinessDays(from: Date, days: number, holidays: ReadonlySet<string>): Date {
  if (!Number.isInteger(days) || days < 0)
    throw new RangeError('days must be a non-negative integer');
  let zoned = toZoned(from);
  let remaining = days;
  while (remaining > 0) {
    zoned = zoned.add({ days: 1 });
    if (zoned.dayOfWeek <= 5 && !holidays.has(zoned.toPlainDate().toString())) remaining--;
  }
  return new Date(zoned.epochMilliseconds);
}

export function holidaySet(holidays: Iterable<Holiday | string>): Set<string> {
  return new Set(Array.from(holidays, (h) => (typeof h === 'string' ? h : h.date)));
}
