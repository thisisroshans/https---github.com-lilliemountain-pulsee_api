import { describe, expect, it } from 'vitest';

import {
  addLocalDays,
  daysBetween,
  isValidLocalDate,
  localDayBounds,
  localDateRange,
  toLocalDate,
  todayIn,
  yesterdayOf,
} from '../../src/shared/utils/local-date.js';
import { ValidationError } from '../../src/shared/errors/index.js';

/**
 * Streaks, adherence and "today's workout" all hinge on this. A one-day slip
 * here silently breaks a user's streak, which is the retention mechanic — so
 * the timezone edges are pinned explicitly.
 */

const IST = 'Asia/Kolkata';

describe('toLocalDate', () => {
  it('uses the local day, not the UTC day, late in the evening', () => {
    // 21:00 IST on 2 Aug is 15:30 UTC the same day — the easy case.
    expect(toLocalDate(new Date('2026-08-02T15:30:00Z'), IST)).toBe('2026-08-02');
  });

  it('keeps a small-hours log on the correct local day', () => {
    // 02:00 IST on 3 Aug is 20:30 UTC on 2 Aug. Treating it as UTC would file a
    // late-night snack under the previous day and break the streak.
    expect(toLocalDate(new Date('2026-08-02T20:30:00Z'), IST)).toBe('2026-08-03');
  });

  it('handles the IST half-hour offset either side of midnight', () => {
    expect(toLocalDate(new Date('2026-08-02T18:29:00Z'), IST)).toBe('2026-08-02');
    expect(toLocalDate(new Date('2026-08-02T18:30:00Z'), IST)).toBe('2026-08-03');
  });

  it('gives different days for the same instant in different zones', () => {
    const instant = new Date('2026-08-02T20:00:00Z');

    expect(toLocalDate(instant, IST)).toBe('2026-08-03');
    expect(toLocalDate(instant, 'America/New_York')).toBe('2026-08-02');
  });

  it('respects a daylight-saving zone', () => {
    // 23:30 EDT on 1 Aug is 03:30 UTC on 2 Aug.
    expect(toLocalDate(new Date('2026-08-02T03:30:00Z'), 'America/New_York')).toBe('2026-08-01');
  });
});

describe('todayIn', () => {
  it('reads the current day in the given zone', () => {
    expect(todayIn(IST, new Date('2026-08-02T20:30:00Z'))).toBe('2026-08-03');
  });
});

describe('calendar arithmetic', () => {
  it('steps backwards a day', () => {
    expect(yesterdayOf('2026-08-01')).toBe('2026-07-31');
  });

  it('crosses a month boundary', () => {
    expect(addLocalDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(yesterdayOf('2027-01-01')).toBe('2026-12-31');
  });

  it('handles a leap day', () => {
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('counts whole days between dates, signed', () => {
    expect(daysBetween('2026-08-01', '2026-08-08')).toBe(7);
    expect(daysBetween('2026-08-08', '2026-08-01')).toBe(-7);
    expect(daysBetween('2026-08-01', '2026-08-01')).toBe(0);
  });

  it('builds an inclusive range', () => {
    expect(localDateRange('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
    expect(localDateRange('2026-08-01', '2026-08-01')).toEqual(['2026-08-01']);
  });

  it('returns an empty range when the end precedes the start', () => {
    expect(localDateRange('2026-08-04', '2026-08-01')).toEqual([]);
  });
});

describe('localDayBounds', () => {
  it('spans exactly the local day in UTC terms', () => {
    const { start, end } = localDayBounds('2026-08-02', IST);

    // IST is UTC+05:30, so the local day starts at 18:30 UTC the day before.
    expect(start.toISOString()).toBe('2026-08-01T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-08-02T18:30:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('produces bounds that contain an instant on that local day', () => {
    const { start, end } = localDayBounds('2026-08-02', IST);
    const lateNight = new Date('2026-08-02T18:00:00Z'); // 23:30 IST on 2 Aug

    expect(lateNight.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(lateNight.getTime()).toBeLessThan(end.getTime());
  });
});

describe('validation', () => {
  it.each(['2026-08-02', '2028-02-29'])('accepts %s', (value) => {
    expect(isValidLocalDate(value)).toBe(true);
  });

  it.each(['2026-8-2', '02-08-2026', '2026-13-01', '2026-02-30', 'today', ''])('rejects %s', (value) => {
    expect(isValidLocalDate(value)).toBe(false);
  });

  it('throws a validation error rather than silently shifting a bad date', () => {
    expect(() => localDayBounds('2026-02-30', IST)).toThrow(ValidationError);
  });
});
