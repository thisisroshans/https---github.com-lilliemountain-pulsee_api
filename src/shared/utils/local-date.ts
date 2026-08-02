import { TZDate } from '@date-fns/tz';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

import { DEFAULT_TIMEZONE } from '../../config/constants.js';
import { ValidationError } from '../errors/index.js';

/**
 * "Today" in the user's timezone.
 *
 * Timestamps are stored in UTC, but almost every product question — did they
 * train today, is the streak alive, which meals are due — is about a *local
 * calendar day*. A user in Asia/Kolkata logging dinner at 21:00 IST is at 15:30
 * UTC; treating that as a UTC day would file it correctly, but the same user
 * logging a late snack at 02:00 IST is at 20:30 UTC the *previous* day, and
 * their streak would silently break.
 *
 * Local dates are represented as "YYYY-MM-DD" strings: unambiguous, sortable,
 * comparable, and impossible to accidentally shift by a timezone conversion.
 */

export type LocalDate = string;

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day `instant` falls on, in `timezone`. */
export function toLocalDate(instant: Date, timezone: string = DEFAULT_TIMEZONE): LocalDate {
  return format(new TZDate(instant, timezone), 'yyyy-MM-dd');
}

export function todayIn(timezone: string = DEFAULT_TIMEZONE, now: Date = new Date()): LocalDate {
  return toLocalDate(now, timezone);
}

export function yesterdayOf(date: LocalDate): LocalDate {
  return format(addDays(parseLocalDate(date), -1), 'yyyy-MM-dd');
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  return format(addDays(parseLocalDate(date), days), 'yyyy-MM-dd');
}

/** Whole calendar days between two local dates; negative if `from` is later. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return differenceInCalendarDays(parseLocalDate(to), parseLocalDate(from));
}

/** Inclusive list of local dates, oldest first. */
export function localDateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const span = daysBetween(from, to);
  if (span < 0) return [];

  return Array.from({ length: span + 1 }, (_value, offset) => addLocalDays(from, offset));
}

/**
 * The UTC instant range covering a local calendar day, for querying timestamp
 * columns: `createdAt >= start && createdAt < end`.
 */
export function localDayBounds(
  date: LocalDate,
  timezone: string = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  assertLocalDate(date);

  const start = new TZDate(`${date}T00:00:00`, timezone);
  const end = new TZDate(`${addLocalDays(date, 1)}T00:00:00`, timezone);

  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE_PATTERN.test(value)) return false;
  const parsed = parseISO(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && format(parsed, 'yyyy-MM-dd') === value;
}

function assertLocalDate(value: string): void {
  if (!isValidLocalDate(value)) {
    throw new ValidationError('Invalid date.', [
      { path: 'date', message: 'Must be a real calendar date in YYYY-MM-DD form.' },
    ]);
  }
}

/** Parsed as UTC midnight purely for calendar arithmetic — never for display. */
function parseLocalDate(date: LocalDate): Date {
  assertLocalDate(date);
  return parseISO(`${date}T00:00:00Z`);
}
