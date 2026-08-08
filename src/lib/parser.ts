/**
 * parser.ts - Turn a real Costco "Employee Weekly Schedule" .xlsx into per-day
 * BreakAid rosters. Replaces the old mock employee data.
 *
 * File shape (see project memory "breakaid-schedule-file-format"):
 *   - One sheet ("Report"). Row 1: `Time Period : <start> - <end>`.
 *   - Grouped by department; each section: a `… - Location :` header line, an
 *     `Employee | FTE | <Day date> | … | Weekly Total` header row, then rows.
 *   - Days are COLUMNS named like "Mon 05/11/2026" between FTE and Weekly Total.
 *   - Shift cell: `START - END HOURS[x <dept> <code> <role>]`; two shifts are
 *     newline-separated; blank / "CA Vacation Day" = off; times can be off-grid.
 *
 * Door roster per day (manager's rule) = the UNION of every employee WORKING in
 * the `086-Security` section that day, PLUS anyone in any section whose shift
 * that day is tagged `MBR SRV` (borrowed helpers).
 */

import type { Employee } from "./types";

/** A single day extracted from the workbook, ready for the gameplan builder. */
export type ParsedDay = {
  /** Header label, e.g. "Mon 05/11/2026". */
  dateLabel: string;
  /** Three-letter weekday, e.g. "Mon". */
  weekday: string;
  /** True for Sat/Sun (drives the weekend ruleset - no manual toggle needed). */
  isWeekend: boolean;
  /** The door roster for this day. */
  employees: Employee[];
  /**
   * Reserve pool: everyone else scheduled that day who is NOT on the door team.
   * A manager can pull one of these in as a helper when short-staffed. They are
   * kept out of the grid and out of Employee Management until explicitly added.
   */
  additional: Employee[];
};

export type ScheduleParseResult = {
  /** Raw "Time Period" range string from row 1, e.g. "2026-05-11 - 2026-05-11". */
  timePeriod: string;
  /** One entry per day column found in the sheet. */
  days: ParsedDay[];
  /** Non-fatal issues worth surfacing to the manager. */
  warnings: string[];
};

// The home department for the door / Member Service team, and the borrow tag.
const DOOR_SECTION_RE = /security/i;   // "086-Security" (tolerant across warehouses)
const MBR_ROLE = "MBR SRV";
const WEEKDAY_RE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/;

// 7:00 AM is slot 0; each slot is 30 minutes. (Matches TIME_SLOTS in generator.ts.)
const GRID_START_MIN = 7 * 60;
const SLOT_MINUTES = 30;
const LAST_SLOT_IDX = 34; // "0:00" (midnight) - the grid ends here.

/** "HH:MM" → minutes since midnight, or null. */
function parseHHMM(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Minutes-since-midnight → nearest 30-min slot index (0 = 7:00; may be negative pre-7AM). */
function timeToSlotIdx(min: number): number {
  return Math.round((min - GRID_START_MIN) / SLOT_MINUTES);
}

/**
 * Minutes-since-midnight → compact clock label like the paper Gameplan form
 * ("840" = 8:40, "1430" = 14:30, "0000" = midnight). Uses the real (un-snapped)
 * times so off-grid shifts (8:40, 17:10) print accurately.
 */
function formatClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  if (h === 0 && m === 0) return "0000";
  return `${h}${String(m).padStart(2, "0")}`;
}

/**
 * Build a one-off {@link Employee} from a typed-in name and start/end time
 * ("HH:MM"), for the builder's "this person is not in the file" case - a
 * walk-in helper the schedule does not list. Deliberately reuses the SAME slot
 * maths and compact shift label as the parsed roster, so a temporary person
 * sorts, generates and prints exactly like everyone else.
 *
 * Returns null when the name is blank, either time is unparseable, or the shift
 * would not cover a single slot. An end at or before the start is read as
 * crossing midnight, matching {@link parseShiftSpan}.
 */
export function buildTemporaryEmployee(
  name: string,
  startHHMM: string,
  endHHMM: string
): Employee | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const startMin = parseHHMM(startHHMM);
  let endMin = parseHHMM(endHHMM);
  if (startMin == null || endMin == null) return null;
  // The same time twice is a typo when it is typed by hand, not a 24-hour shift.
  if (endMin === startMin) return null;
  if (endMin < startMin) endMin += 24 * 60; // crosses midnight
  const shiftStartIdx = timeToSlotIdx(startMin);
  const shiftEndIdx = Math.min(timeToSlotIdx(endMin), LAST_SLOT_IDX);
  if (shiftEndIdx <= shiftStartIdx) return null;
  return {
    name: trimmed,
    shift: `${formatClock(startMin)}-${formatClock(endMin)}`,
    // Same defaults the file parser uses; the manager can adjust them in the
    // Capabilities modal before generating.
    canWalk: true,
    canSec: false,
    canFE: true,
    doorSide: "both",
    temporary: true,
    shiftStartIdx,
    shiftEndIdx,
    shiftLengthHours: Math.round(((endMin - startMin) / 60) * 4) / 4,
  };
}

/**
 * Parse a schedule cell into a clock span. Supports multiple newline-separated
 * shifts (uses the earliest start … latest end). Treats an end ≤ start as
 * crossing midnight (e.g. "15:30 - 00:00"). Returns null for off/vacation/blank
 * cells (no HH:MM-HH:MM pattern).
 */
function parseShiftSpan(cell: string): { startMin: number; endMin: number } | null {
  if (!cell) return null;
  const segs = [...cell.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)];
  let start = Infinity;
  let end = -Infinity;
  for (const seg of segs) {
    const a = parseHHMM(seg[1]);
    let b = parseHHMM(seg[2]);
    if (a == null || b == null) continue;
    if (b <= a) b += 24 * 60; // crosses midnight
    start = Math.min(start, a);
    end = Math.max(end, b);
  }
  if (start === Infinity || end === -Infinity) return null;
  return { startMin: start, endMin: end };
}

/** Build an Employee from a name + raw shift cell, or null if off that day. */
function toEmployee(name: string, cell: string): Employee | null {
  const span = parseShiftSpan(cell);
  if (!span) return null;

  const shiftStartIdx = timeToSlotIdx(span.startMin);
  const shiftEndIdx = Math.min(timeToSlotIdx(span.endMin), LAST_SLOT_IDX);
  // Clock span (the file's printed hours are PAID hours, ~0.5h less).
  const shiftLengthHours = Math.round(((span.endMin - span.startMin) / 60) * 4) / 4;

  return {
    name,
    // Compact clock span like the paper form ("840-1710", "1530-0000").
    shift: `${formatClock(span.startMin)}-${formatClock(span.endMin)}`,
    // Capabilities are NOT in the schedule - they come from the Employee
    // Management page. Default sensibly until that exists.
    canWalk: true,
    canSec: false,
    canFE: true,
    doorSide: "both",
    shiftStartIdx,
    shiftEndIdx,
    shiftLengthHours,
  };
}

/**
 * Parse a workbook already converted to a 2-D array of strings
 * (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })).
 */
export function parseScheduleRows(rows: string[][]): ScheduleParseResult {
  const warnings: string[] = [];

  // 1) Time Period (row 1-ish): the cell after a "Time Period" label.
  let timePeriod = "";
  for (const r of rows) {
    const i = r.findIndex((c) => String(c).includes("Time Period"));
    if (i >= 0) {
      timePeriod = String(r[i + 1] ?? "").trim();
      break;
    }
  }

  // 2) Day columns: from the first "Employee" header row, any column whose
  //    header names a weekday + date. Assumes columns are consistent across
  //    sections (they are - every section repeats the same header).
  const dayCols: { col: number; label: string; weekday: string; isWeekend: boolean }[] = [];
  for (const r of rows) {
    if (String(r[0]).trim() !== "Employee") continue;
    r.forEach((c, col) => {
      const v = String(c).trim();
      if (WEEKDAY_RE.test(v) && /\d/.test(v) && !dayCols.some((d) => d.col === col)) {
        const wd = v.match(WEEKDAY_RE)![1];
        dayCols.push({ col, label: v, weekday: wd, isWeekend: wd === "Sat" || wd === "Sun" });
      }
    });
    if (dayCols.length) break;
  }
  if (dayCols.length === 0) {
    warnings.push("No day columns found - is this a Costco Weekly Schedule export?");
    return { timePeriod, days: [], warnings };
  }

  // 3) Flatten to employee records, tracking the current department section.
  const records: { name: string; section: string; row: string[] }[] = [];
  let section = "";
  for (const r of rows) {
    const c0 = String(r[0] ?? "").trim();
    if (c0.includes("Location :")) {
      section = c0.split(" - Location")[0].trim();
      continue;
    }
    if (c0 === "" || c0 === "Employee") continue;
    records.push({ name: c0, section, row: r });
  }

  // Chronological order: earliest shift START first; when two people start
  // together, the one who FINISHES earlier comes first; names break the rest.
  const byShift = (a: Employee, b: Employee) =>
    a.shiftStartIdx - b.shiftStartIdx ||
    a.shiftEndIdx - b.shiftEndIdx ||
    a.name.localeCompare(b.name);

  // 4) Per day, build the door roster (086-Security ∪ MBR SRV tagged elsewhere)
  //    AND a reserve pool of everyone else scheduled that day, so a manager can
  //    pull in a helper when short-staffed. The pool is never auto-registered;
  //    a person becomes "known" only when explicitly added to a plan.
  const days: ParsedDay[] = dayCols.map((d) => {
    const doorSeen = new Set<string>();
    const employees: Employee[] = [];
    const poolSeen = new Set<string>();
    const additional: Employee[] = [];
    for (const rec of records) {
      const cell = String(rec.row[d.col] ?? "");
      const emp = toEmployee(rec.name, cell);
      if (!emp) continue; // off / vacation / no parseable shift
      const onDoorTeam = DOOR_SECTION_RE.test(rec.section) || cell.includes(MBR_ROLE);
      if (onDoorTeam) {
        if (doorSeen.has(emp.name)) continue;
        doorSeen.add(emp.name);
        employees.push(emp);
      } else {
        if (poolSeen.has(emp.name)) continue;
        poolSeen.add(emp.name);
        additional.push(emp);
      }
    }
    // A name seen in both a door row and a non-door row belongs to the door
    // team; drop it from the reserve pool so it is never offered twice.
    const reserve = additional.filter((e) => !doorSeen.has(e.name));
    if (employees.length === 0) {
      warnings.push(`No door staff found for ${d.label}.`);
    }
    employees.sort(byShift);
    reserve.sort(byShift);
    return {
      dateLabel: d.label,
      weekday: d.weekday,
      isWeekend: d.isWeekend,
      employees,
      additional: reserve,
    };
  });

  return { timePeriod, days, warnings };
}
