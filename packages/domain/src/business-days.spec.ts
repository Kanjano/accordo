import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  easterSunday,
  holidaySet,
  isBusinessDay,
  italianHolidays,
} from './business-days.js';

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2038, '2038-04-25'],
  ])('%i → %s', (year, date) => expect(easterSunday(year)).toBe(date));
});

describe('italianHolidays', () => {
  it('has 12 national holidays from 2026, including 4 October and Easter Monday', () => {
    const h = italianHolidays(2026);
    expect(h).toHaveLength(12);
    expect(h.map((x) => x.date)).toContain('2026-10-04');
    expect(h).toContainEqual({ date: '2026-04-06', name: "Lunedì dell'Angelo" });
    expect(h.map((x) => x.date)).toEqual([...h.map((x) => x.date)].sort());
  });
  it('4 October is not a national holiday before 2026', () => {
    expect(italianHolidays(2025).map((x) => x.date)).not.toContain('2025-10-04');
  });
});

describe('business days', () => {
  const holidays = holidaySet(italianHolidays(2026));

  it('weekends and holidays are not business days (Rome calendar)', () => {
    expect(isBusinessDay(new Date('2026-10-30T10:00:00Z'), holidays)).toBe(true); // Friday
    expect(isBusinessDay(new Date('2026-10-31T10:00:00Z'), holidays)).toBe(false); // Saturday
    expect(isBusinessDay(new Date('2026-06-02T10:00:00Z'), holidays)).toBe(false); // Republic Day
    // 23:30 UTC on Friday is already Saturday in Rome
    expect(isBusinessDay(new Date('2026-10-30T23:30:00Z'), holidays)).toBe(false);
  });

  it('skips weekends', () => {
    // Friday 2026-10-23 10:00 Rome (CEST) + 5 → Friday 2026-10-30 10:00 Rome (CET after DST end)
    expect(addBusinessDays(new Date('2026-10-23T08:00:00Z'), 5, holidays).toISOString()).toBe(
      '2026-10-30T09:00:00.000Z',
    );
  });

  it('skips holidays', () => {
    // Thursday 2026-12-24 + 2 → skips 25 (Fri), 26 (Sat), 27 (Sun) → Mon 28, Tue 29
    expect(addBusinessDays(new Date('2026-12-24T09:00:00Z'), 2, holidays).toISOString()).toBe(
      '2026-12-29T09:00:00.000Z',
    );
    // Wednesday 2026-04-01 + 3 → Thu 2, Fri 3, (Easter weekend, Easter Monday 6) → Tue 7
    expect(addBusinessDays(new Date('2026-04-01T08:00:00Z'), 3, holidays).toISOString()).toBe(
      '2026-04-07T08:00:00.000Z',
    );
  });

  it('zero days is a no-op; negative throws', () => {
    const d = new Date('2026-10-31T10:00:00Z');
    expect(addBusinessDays(d, 0, holidays)).toEqual(d);
    expect(() => addBusinessDays(d, -1, holidays)).toThrow();
  });

  it('holidaySet accepts strings', () => {
    expect(holidaySet(['2026-01-01']).has('2026-01-01')).toBe(true);
  });
});
