/**
 * types.ts - Shared domain types for the BreakAid Gameplan system.
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
// "IN"/"OUT" = door duty at the entrance/exit - the generator's real door codes
// (business rule 2026-07: plain "D" was retired so entrance/exit time is rotated
// fairly; "D" stays a LEGAL code only so gameplans saved before the change still
// load and print). "PUSH" = cart-pushing right after the store closes. "FE HELP"
// is a TEMPORARY code used only by the feedback-capture UI to flag a
// short-handed door that needs help - the generator surfaces understaffing via a
// separate per-slot help row, not by writing "FE HELP" into a cell; the code
// stays available for manual manager corrections and is safe to remove with the
// feedback scaffolding once deterministic rules are finalized.
export type TaskCode =
  | ""
  | "IN"
  | "OUT"
  | "D"
  | "W"
  | "B"
  | "B/D"
  | "SEC"
  | "FE"
  | "PUSH"
  | "FE HELP";

/**
 * Ordered list of all legal task codes for the manual-cycle UI feature.
 * The empty string first means clicking an active cell starts blank. Legacy "D"
 * is intentionally absent - manual edits pick a side (IN or OUT).
 */
export const TASK_CYCLE: TaskCode[] = ["", "W", "IN", "OUT", "B", "FE", "SEC", "B/D", "PUSH", "FE HELP"];

/**
 * Where an employee is allowed to stand when on door duty.
 *   "both" - rotates fairly between entrance (IN) and exit (OUT). The default.
 *   "in" - entrance ONLY (e.g. medical accommodation).
 *   "out" - exit ONLY.
 */
export type DoorSide = "both" | "in" | "out";

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
 * shiftEndIdx is EXCLUSIVE - the employee is NOT active at that slot index.
 */
export type Employee = {
  /** Roster name, e.g. "Far" or "Jen L". The key that matches the schedule file. */
  name: string;

  /**
   * Optional friendlier label shown on the gameplan (grid, print, phone view)
   * in place of `name`. `name` stays the key, so the schedule still matches.
   */
  displayName?: string;

  /** Human-readable shift label from the source file, e.g. "7:50-16:20" */
  shift: string;

  /** True if this employee is authorized to perform Walk (W) assignments */
  canWalk: boolean;

  /** True if this employee is authorized to perform Security (SEC) duty */
  canSec: boolean;

  /**
   * Door-side restriction (see {@link DoorSide}). Optional because rosters
   * saved before this field existed lack it - absent means "both".
   */
  doorSide?: DoorSide;

  /** Inclusive start index in TIME_SLOTS. May be negative for pre-7 AM starts. */
  shiftStartIdx: number;

  /** Exclusive end index in TIME_SLOTS. */
  shiftEndIdx: number;

  /** Total shift duration in hours, e.g. 8.5 or 5 */
  shiftLengthHours: number;
};

// ---------------------------------------------------------------------------
// EmployeeRecord - the persisted, manager-owned employee profile
// ---------------------------------------------------------------------------

/**
 * A persisted employee profile, keyed by `name`. This is what the Employee
 * Management page reads/writes and what overlays capabilities onto each freshly
 * parsed roster (the schedule file carries names + shift times only).
 *
 * It is deliberately separate from {@link Employee}: an Employee is a single
 * day's working instance (with shift indices), whereas an EmployeeRecord is the
 * durable profile that survives across uploads. The persistence backend
 * (localStorage today, Supabase later) stores these - see `employeeStore.ts`.
 */
export type EmployeeRecord = {
  /** Roster name - the primary key. Matches Employee.name exactly. */
  name: string;

  /**
   * Optional friendlier label shown on the gameplan in place of `name`. Set by a
   * manager (Employees page) or by the person themselves on their profile.
   */
  displayName?: string;

  /**
   * Job/position label (e.g. "086-Security", "MBR SRV"). Manager-editable;
   * intended to be seeded from the schedule's section later. Optional for now.
   */
  position?: string;

  /** Authorized to perform Walk (W) assignments. */
  canWalk: boolean;

  /** Authorized to perform Security (SEC) duty. */
  canSec: boolean;

  /** Door-side restriction - "both" unless the person can only do one side. */
  doorSide: DoorSide;

  /**
   * True if this person should NOT be auto-placed on the door team, even though
   * the schedule file still lists them under Security (e.g. their position
   * hasn't been updated in the source system yet). Managers set this by choosing
   * "permanently off the door" when swapping staff. Default/undefined = on the
   * door. They can still be added back for a single day, and this is reversible
   * from the Employees page.
   */
  doorExcluded?: boolean;

  /** Most recent shift label seen for this person, for at-a-glance context. */
  lastShift?: string;

  /** ISO-8601 timestamp of the last edit to this record. */
  updatedAt?: string;
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

// ---------------------------------------------------------------------------
// FinalizedGameplan - a saved day, ready to reprint
// ---------------------------------------------------------------------------

/**
 * A finalized day's gameplan, persisted so it can be reloaded and re-printed.
 * Keyed by `date` (the day-picker's date label, e.g. "Thu 06/18/2026"). Stores
 * a snapshot of the roster (names + shifts + shift indices) alongside the grid
 * of codes, so the printed sheet is reproducible exactly as finalized - even
 * after manual corrections.
 */
export type FinalizedGameplan = {
  /** Date label - the primary key (matches ParsedDay.dateLabel). */
  date: string;
  /** Weekend ruleset flag the plan was built under. */
  isWeekend: boolean;
  /** Roster snapshot at finalize time (names, shifts, shift indices). */
  roster: Employee[];
  /** The grid of task codes (name → time slot → code). */
  plan: Gameplan;
  /** ISO-8601 timestamp of when it was finalized/saved. */
  finalizedAt?: string;
  /** Audit trail (DB-stamped, read-only): who first finalized this day. */
  createdByEmail?: string;
  /** Audit trail (DB-stamped, read-only): who last modified it. */
  updatedByEmail?: string;
};
