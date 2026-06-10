/**
 * Shared TypeScript types and interfaces for BreakAid.
 *
 * This is the single source of truth for all data models used across
 * the parser, algorithm, and UI layers.
 *
 * ⚠️  Any change to a type must be discussed with both developers before merging.
 */

// ---------------------------------------------------------------------------
// TaskCode
// ---------------------------------------------------------------------------

/**
 * The set of tasks that can be assigned to an employee at a given time slot.
 *
 * - D    → Door / greeter duty
 * - W    → Walk (floor patrol)
 * - B    → Break coverage
 * - B/D  → Combined Break + Door coverage
 * - FE   → Front-End supervision
 * - SEC  → Security post
 * - null → No assignment (employee is off-floor or shift has not started/ended)
 */
export type TaskCode = 'D' | 'W' | 'B' | 'B/D' | 'FE' | 'SEC' | null;

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

/**
 * Represents a single employee working on the day the gameplan covers.
 */
export interface Employee {
  /** Full display name as it appears on the schedule (e.g. "Jen L", "Shajeed"). */
  name: string;

  /**
   * Shift start time in 24-hour "HH:MM" format (e.g. "07:50", "14:45").
   * Parsed from the raw schedule string (e.g. "750-1620" → "07:50").
   */
  shiftStart: string;

  /**
   * Shift end time in 24-hour "HH:MM" format (e.g. "16:20", "23:15").
   * Parsed from the raw schedule string (e.g. "750-1620" → "16:20").
   */
  shiftEnd: string;

  /** Whether this employee is eligible to be assigned a Walk (W) task. */
  canWalk: boolean;

  /** Whether this employee is eligible to be assigned a Security (SEC) task. */
  canSec: boolean;
}

// ---------------------------------------------------------------------------
// TimeSlot
// ---------------------------------------------------------------------------

/**
 * Represents a single 30-minute block in the daily gameplan grid.
 */
export interface TimeSlot {
  /**
   * The time label for this slot in "H:MM" or "HH:MM" format,
   * exactly as it appears in the source gameplan (e.g. "7:00", "13:30").
   */
  time: string;

  /**
   * A mapping from employee name to their assigned TaskCode for this slot.
   * Only employees whose shift covers this slot will have an entry.
   * A value of null means the employee is present but has no task assigned.
   *
   * Key   → Employee.name
   * Value → TaskCode
   */
  assignments: Record<string, TaskCode>;
}

// ---------------------------------------------------------------------------
// Gameplan
// ---------------------------------------------------------------------------

/**
 * The top-level structure representing a full day's member-service gameplan.
 */
export interface Gameplan {
  /**
   * The date this gameplan applies to, as a human-readable string
   * (e.g. "Sat April 4").  Stored as a string to preserve the
   * original label from the source document.
   */
  date: string;

  /** All employees scheduled to work on this date. */
  employees: Employee[];

  /**
   * Ordered list of 30-minute time slots covering the full operating day,
   * from the first shift start to the last shift end.
   */
  timeSlots: TimeSlot[];
}
