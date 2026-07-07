/**
 * parser.ts — Turn a real Costco "Employee Weekly Schedule" .xlsx into per-day
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
  /** True for Sat/Sun (drives the weekend ruleset — no manual toggle needed). */
  isWeekend: boolean;
  /** The door roster for this day. */
  employees: Employee[];
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
const LAST_SLOT_IDX = 34; // "0:00" (midnight) — the grid ends here.

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
    // Capabilities are NOT in the schedule — they come from the Employee
    // Management page. Default sensibly until that exists.
    canWalk: true,
    canSec: false,
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
  //    sections (they are — every section repeats the same header).
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
    warnings.push("No day columns found — is this a Costco Weekly Schedule export?");
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

  // 4) Per day, build the door roster (086-Security ∪ MBR SRV tagged elsewhere).
  const days: ParsedDay[] = dayCols.map((d) => {
    const seen = new Set<string>();
    const employees: Employee[] = [];
    for (const rec of records) {
      const cell = String(rec.row[d.col] ?? "");
      const inDoorSection = DOOR_SECTION_RE.test(rec.section);
      const taggedMbr = cell.includes(MBR_ROLE);
      if (!inDoorSection && !taggedMbr) continue;
      const emp = toEmployee(rec.name, cell);
      if (!emp) continue; // off / vacation / no parseable shift
      if (seen.has(emp.name)) continue;
      seen.add(emp.name);
      employees.push(emp);
    }
    if (employees.length === 0) {
      warnings.push(`No door staff found for ${d.label}.`);
    }
    // Chronological columns: earliest shift START first; when two people start
    // together, the one who FINISHES earlier comes first; names break the rest.
    employees.sort(
      (a, b) =>
        a.shiftStartIdx - b.shiftStartIdx ||
        a.shiftEndIdx - b.shiftEndIdx ||
        a.name.localeCompare(b.name)
    );
    return { dateLabel: d.label, weekday: d.weekday, isWeekend: d.isWeekend, employees };
  });

  return { timePeriod, days, warnings };
}
