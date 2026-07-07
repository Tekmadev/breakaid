// TEMPORARY — feedback capture scaffolding for algorithm training. Safe to delete once deterministic rules are finalized.
//
// This module collects manager corrections to an auto-generated Gameplan into a
// self-contained JSON artifact. A developer with NO access to the running app
// can read the exported "breakaid-feedback.json" to understand exactly WHY each
// cell was changed, and use those labels to design a deterministic scheduling
// algorithm. There is NO runtime AI here — everything is local + localStorage.

import type { Employee, Gameplan } from "./types";

// ---------------------------------------------------------------------------
// Correction vocabulary
// ---------------------------------------------------------------------------

/**
 * The structured reason a manager gives for changing a cell. Multiple reasons
 * may apply to a single correction (multi-select in the UI).
 */
export type CorrectionReason =
  | "break-too-late"
  | "break-too-early"
  | "breaks-bunched"
  | "need-help-at-door"
  | "keep-on-door"
  | "wrong-walk"
  | "coverage-problem"
  | "wrong-person-sec"
  | "other";

/**
 * How broadly the manager intends the correction to apply. Single-select in
 * the UI. Captured as a training signal — the running app does not act on it.
 */
export type CorrectionScope = "once" | "employee" | "similar-shifts" | "everyone";

/**
 * A single labeled correction: one cell change plus the structured rationale.
 *
 * All employee fields are denormalized onto the correction so the exported
 * JSON is self-contained — the developer never has to cross-reference the
 * roster to understand the employee's constraints at the moment of the change.
 */
export type Correction = {
  /** Stable unique id (crypto.randomUUID). */
  id: string;
  /** The FeedbackSession this correction belongs to (links it to its baseline). */
  sessionId: string;
  /**
   * Monotonic 0-based ordinal within the session. Corrections MUST be replayed
   * onto `generatedGameplan` in ascending `sequence` order — `timestamp` alone
   * is not safe to sort by (millisecond ties). doorCoverageBefore/After are
   * CUMULATIVE: measured against the grid as it stood after all lower-sequence
   * corrections, not against the pristine baseline.
   */
  sequence: number;
  /**
   * true  → the manager picked at least one reason ("Save feedback").
   * false → an unlabeled edit the manager chose to keep without explaining
   *         ("Skip"). Unlabeled corrections still alter the grid, so they are
   *         recorded to keep the replay faithful, but carry no rationale.
   */
  labeled: boolean;
  /** ISO-8601 timestamp of when the correction was recorded (Date.toISOString). */
  timestamp: string;
  /** Employee whose cell was edited. */
  employeeName: string;
  /** Human-readable shift label, e.g. "750-1620". */
  employeeShift: string;
  /** Shift length in hours, drives break rules (8.5, 5, …). */
  employeeShiftLengthHours: number;
  /** Whether the employee is Walk-authorized. */
  employeeCanWalk: boolean;
  /** Whether the employee is Security-authorized. */
  employeeCanSec: boolean;
  /** Time slot label of the edited cell, e.g. "13:30". */
  time: string;
  /** Index of the edited cell in TIME_SLOTS. */
  slotIdx: number;
  /** Task code before the change ("" = empty). */
  oldTask: string;
  /** Task code after the change ("" = cleared). */
  newTask: string;
  /** One or more structured reasons. */
  reasons: CorrectionReason[];
  /** How broadly the manager wants this to apply. */
  scope: CorrectionScope;
  /** Free-text explanation in the manager's own words (may be empty). */
  note: string;
  /** Door coverage at `time` BEFORE the change was applied. */
  doorCoverageBefore: number;
  /** Door coverage at `time` AFTER the change was applied. */
  doorCoverageAfter: number;
};

/**
 * The full feedback session: the generated baseline plus every correction the
 * manager made against it. Reset each time Auto Generate produces a new plan.
 */
export type FeedbackSession = {
  /** Stable unique id for this baseline (crypto.randomUUID). Stamped on each correction. */
  sessionId: string;
  /** ISO-8601 timestamp of when the baseline was generated. */
  generatedAt: string;
  /**
   * Whether the baseline was generated for the weekend ruleset. Set from the
   * app's Weekday/Weekend toggle (auto-detected on upload, manager-overridable),
   * so it reflects the day type the plan was actually generated under.
   */
  isWeekend: boolean;
  /**
   * The canonical 30-minute slot labels, index-aligned with every `slotIdx`
   * and with `shiftStartIdx`/`shiftEndIdx`. Embedded so the export is fully
   * self-contained on the time axis (index 0 = "7:00" … last = "0:00").
   * A negative shift index counts backwards from index 0 (pre-7AM start).
   */
  timeSlots: string[];
  /**
   * The door-coverage rule the baseline was built to, so coverage numbers are
   * interpretable from the JSON alone.
   */
  coverageRule: {
    /** Plain-English definition of what counts toward door coverage. */
    definition: string;
    /** Coverage must never drop below this (the floor). */
    min: number;
    /** Ideal coverage the generator targets. */
    target: number;
  };
  /** The roster the baseline was generated from (a deep snapshot, not a live reference). */
  roster: Employee[];
  /** The auto-generated baseline Gameplan (deep clone, before any corrections). */
  generatedGameplan: Gameplan;
  /** Every correction made against the baseline, in `sequence` order. */
  corrections: Correction[];
};

// ---------------------------------------------------------------------------
// Persistence (localStorage; SSR-safe)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "breakaid-feedback-session";

/**
 * Load the persisted session, or null if none exists / cannot be parsed.
 * Returns null during SSR (no window) so this is safe to call anywhere.
 */
export function loadSession(): FeedbackSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FeedbackSession;
  } catch {
    // Corrupt or unreadable JSON — treat as no session rather than throwing.
    return null;
  }
}

/**
 * Persist the session to localStorage. No-op during SSR.
 */
export function saveSession(session: FeedbackSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be full or disabled (private mode). Failing to persist
    // feedback should never crash the scheduling UI.
  }
}

/**
 * Remove any persisted session. No-op during SSR.
 */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — see saveSession note.
  }
}

// ---------------------------------------------------------------------------
// Export to file
// ---------------------------------------------------------------------------

/**
 * Download the session as a pretty-printed "breakaid-feedback.json" file.
 *
 * Uses Blob + URL.createObjectURL + a temporary <a download> element (NOT a
 * data: URI, which can hit URL-length limits and is less reliable for large
 * payloads). The object URL is revoked afterward to release memory.
 */
export function exportSessionAsFile(session: FeedbackSession): void {
  if (typeof window === "undefined") return;

  const json = JSON.stringify(session, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "breakaid-feedback.json";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Release the object URL once the download has been kicked off.
  URL.revokeObjectURL(url);
}
