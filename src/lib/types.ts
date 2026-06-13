/**
 * types.ts — Shared domain types for the BreakAid Gameplan system.
 *
 * These types are the contract between the CSV parser (SCRUM-9),
 * the scheduling engine (this ticket), and the React UI layer.
 * Changing a type here has compile-time effects everywhere.
 */

// ---------------------------------------------------------------------------
// Task codes
// ---------------------------------------------------------------------------

/**
 * Every cell in the Gameplan grid must be one of these codes.
 * "" = slot falls outside the employee's shift (never rendered as a task).
 */
export type TaskCode = "" | "D" | "W" | "B" | "B/D" | "SEC" | "FE";

/**
 * Ordered list of all legal task codes for the manual-cycle UI feature.
 * The empty string first means clicking an active cell starts at Door.
 */
export const TASK_CYCLE: TaskCode[] = ["", "W", "D", "B", "FE", "SEC", "B/D"];

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

/**
 * A single employee loaded from the weekly schedule file.
 *
 * shiftStartIdx / shiftEndIdx are indices into the TIME_SLOTS array exported
 * from generator.ts. shiftStartIdx can be negative for employees whose shift
 * begins before 7:00 AM (the first visible time slot); the generator handles
 * this correctly.
 *
 * shiftEndIdx is EXCLUSIVE — the employee is NOT active at that slot index.
 */
export type Employee = {
  /** Display name, e.g. "Far" or "Jen L" */
  name: string;

  /** Human-readable shift label from the source file, e.g. "7:50-16:20" */
  shift: string;

  /** True if this employee is authorized to perform Walk (W) assignments */
  canWalk: boolean;

  /** True if this employee is authorized to perform Security (SEC) duty */
  canSec: boolean;

  /** Inclusive start index in TIME_SLOTS. May be negative for pre-7 AM starts. */
  shiftStartIdx: number;

  /** Exclusive end index in TIME_SLOTS. */
  shiftEndIdx: number;

  /** Total shift duration in hours, e.g. 8.5 or 5 */
  shiftLengthHours: number;
};

// ---------------------------------------------------------------------------
// Gameplan
// ---------------------------------------------------------------------------

/**
 * The complete scheduling grid produced by generateGameplan().
 *
 * Indexed as: gameplan[employeeName][timeSlot] → TaskCode
 *
 * - Outer keys match Employee.name values exactly.
 * - Inner keys are time strings from the TIME_SLOTS array ("7:00", "7:30", …).
 * - "" means the slot is outside the employee's shift.
 */
export type Gameplan = Record<string, Record<string, TaskCode>>;
