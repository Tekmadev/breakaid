/**
 * planLock.ts - a gameplan is only editable and (re)finalizable on its own day.
 *
 * Business rule (2026-07): once a day's plan is in the PAST it locks. It can
 * still be printed and exported to Excel, but it can no longer be edited,
 * regenerated, or finalized. Today's plan (and any future day) stays fully
 * editable right up to 11:59 PM of its own date; at midnight it becomes a past
 * day and locks automatically.
 *
 * Dates are compared in the browser's local time (the warehouse's clock).
 */

/** Pull MM/DD/YYYY out of a date label like "Mon 05/11/2026". null if absent. */
export function parsePlanDate(dateLabel: string): Date | null {
  const m = dateLabel.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const d = new Date(year, month - 1, day);
  // Reject impossible values (e.g. 13/40) that Date silently rolls forward.
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** Local midnight (start of day) for a date, as a timestamp. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * True if the plan for `dateLabel` may still be edited/finalized: its date is
 * today or later, so it locks at midnight after its own day. A label with no
 * parseable date is treated as editable, so a valid current plan is never locked
 * by accident.
 */
export function isPlanEditable(dateLabel: string, now: Date = new Date()): boolean {
  const planDate = parsePlanDate(dateLabel);
  if (!planDate) return true;
  return startOfDay(planDate) >= startOfDay(now);
}
