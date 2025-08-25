import { DateTime } from 'luxon';

// Compute week start date (ISO yyyy-mm-dd) given a timezone and week start rule
export function currentWeekStartISO(tz, weekStart) {
  const now = DateTime.now().setZone(tz || 'UTC');
  const weekday = now.weekday; // 1=Mon ... 7=Sun
  const offsetDays = (weekStart === 'SUN') ? (weekday % 7) : (weekday - 1);
  const start = now.startOf('day').minus({ days: offsetDays });
  return start.toISODate();
}

export function previousWeekStartISO(tz, weekStart) {
  const cur = currentWeekStartISO(tz, weekStart);
  const dt = DateTime.fromISO(cur, { zone: tz || 'UTC' });
  return dt.minus({ weeks: 1 }).toISODate();
}

// Given a cron base, produce a string to run weekly just after the rollover
// For MON start, run Monday 00:05; for SUN start, run Sunday 00:05.
export function weeklyCronExpr(weekStart, tz) {
  // minute hour day-of-month month day-of-week
  // 00:05 local-time on the chosen weekday
  const dow = (weekStart === 'SUN') ? 0 : 1; // 0=Sunday, 1=Monday
  // node-cron uses 0-6 for Sun-Sat
  return { expr: `5 0 * * ${dow}`, tz: tz || 'UTC' };
}
