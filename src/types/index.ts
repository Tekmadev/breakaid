/**
 * Shared data models for BreakAid.
 *
 * ParsedEmployee is the raw output of the file parser (lib/parser.ts).
 * Employee is the enriched type used throughout the application after
 * index computation and capability defaults are applied.
 */

/**
 * The direct output of the schedule file parser.
 * Contains only what can be extracted from the file itself — no computed
 * or app-specific fields.
 */
export interface ParsedEmployee {
  /** Full name as it appears in the schedule (e.g. "Jane Doe") */
  name: string;
  /** Shift start time in 24-hour HH:mm format (e.g. "07:50") */
  shiftStart: string;
  /** Shift end time in 24-hour HH:mm format (e.g. "16:20") */
  shiftEnd: string;
  /** Raw shift string as read from the file (e.g. "750-1620") */
  shiftRaw: string;
}

/**
 * The full application Employee — a ParsedEmployee enriched with
 * grid indices and capability flags used by the Auto-Generate engine.
 */
export type Employee = {
  /** Full name as it appears in the schedule */
  name: string;
  /** Raw shift string for display (e.g. "750-1620") */
  shift: string;
  /** Whether this employee is certified to perform Walks */
  canWalk: boolean;
  /** Whether this employee is authorized for Security duties */
  canSec: boolean;
  /** Index into the timeSlots array for shift start (may be negative for pre-7 AM shifts) */
  shiftStartIdx: number;
  /** Index into the timeSlots array for shift end */
  shiftEndIdx: number;
  /** Total shift duration in hours */
  shiftLengthHours: number;
};