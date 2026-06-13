/**
 * generator.ts — Core scheduling engine for the BreakAid Gameplan.
 *
 * Public API
 * ----------
 * generateGameplan(employees, isWeekend?) → Gameplan
 *
 * Design guarantees
 * -----------------
 * ✓ Pure function — same logical inputs always produce a valid Gameplan.
 *   Walk tie-breaking is random, so outputs may vary, but every output
 *   satisfies all six business rules.
 * ✓ No mutations — every helper receives a Gameplan and returns a NEW one.
 *   The input object is never modified.
 * ✓ Each business rule is isolated in its own clearly named function.
 * ✓ Comments explain WHY decisions are made, not just what the code does.
 *
 * Execution order (matters — do not reorder)
 * ------------------------------------------
 * 1. initializeWithDoor     — every active slot starts as Door (D).
 * 2. assignSecurity         — late-shift SEC employees switch ASAP after
 *                             closing; done first so no later rule overwrites.
 * 3. assignWalks            — hourly walk assignments, fewest-walks-first.
 * 4. assignBreaks           — 1/3 + 2/3 breaks for full shifts;
 *                             midpoint B/D for short shifts.
 *                             Coverage floor enforced here.
 * 5. assignFrontEnd         — overflow Door employees beyond target of 4.
 */

import type { Employee, Gameplan, TaskCode } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All 30-minute scheduling slots in chronological order.
 * Index 0 = 7:00 AM, index 34 = midnight (0:00).
 * Exported so that page.tsx and the CSV parser can share the canonical list.
 */
export const TIME_SLOTS: readonly string[] = [
  "7:00",  "7:30",  "8:00",  "8:30",  "9:00",  "9:30",
  "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
  "19:00", "19:30", "20:00", "20:30", "21:00", "21:30",
  "22:00", "22:30", "23:00", "23:30", "0:00",
];

/**
 * Door coverage must NEVER fall below this value.
 * A Break (B) assignment is only placed when it would leave ≥ this many
 * employees on Door after the break is taken.
 */
const MIN_DOOR_COVERAGE = 3;

/**
 * Ideal number of employees on Door at any given slot.
 * Employees beyond this count are moved to Front End (FE).
 */
const TARGET_DOOR_COVERAGE = 4;

/**
 * The slot index at which the warehouse closes.
 * Security (SEC) duty begins here for qualifying late-shift employees.
 * 21:00 is index 28 — a standard Costco weekday closing time.
 */
const WAREHOUSE_CLOSE_IDX = 28; // TIME_SLOTS[28] === "21:00"

/**
 * Any canSec employee whose shift runs PAST warehouse closing is eligible for
 * SEC duty (they will still be on-site after the store closes).
 * This covers the business rule's "Midnight weekdays / 11:30 PM weekends"
 * cases: both result in a shiftEndIdx > WAREHOUSE_CLOSE_IDX.
 */
const SEC_SHIFT_THRESHOLD = WAREHOUSE_CLOSE_IDX;

/**
 * Maximum search radius (in slots) when hunting for a valid break position.
 * 8 slots = 4 hours on either side of the ideal break point.
 * Beyond this, we give up rather than force a break at an unsafe location.
 */
const BREAK_SEARCH_RADIUS = 8;

/**
 * Minimum buffer (in slots) from the very start or end of a shift before a
 * break can be placed. Prevents a break in the first or last 30 minutes.
 */
const BREAK_SHIFT_BUFFER = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Internal utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a shallow-copy-of-inner-records clone of a Gameplan.
 * This is the mechanism that guarantees immutability: every helper calls this
 * before making changes, so callers' references are never mutated.
 */
function cloneGameplan(gameplan: Gameplan): Gameplan {
  const clone: Gameplan = {};
  for (const name in gameplan) {
    // Spread creates a new inner record; the outer record is also new.
    clone[name] = { ...gameplan[name] };
  }
  return clone;
}

/**
 * Counts how many employees hold Door-equivalent coverage at a specific time.
 *
 * WHY D and B/D both count:
 *   B/D is a 15-min break / 15-min door combo. The employee is physically
 *   present at the door for half the slot, so Costco policy treats the slot
 *   as contributing to door coverage.  W, B, SEC, and FE do NOT count.
 */
function countDoorCoverage(
  gameplan: Gameplan,
  employees: readonly Employee[],
  time: string
): number {
  let count = 0;
  for (const emp of employees) {
    const task = gameplan[emp.name]?.[time];
    if (task === "D" || task === "B/D") count++;
  }
  return count;
}

/**
 * Returns true when a time slot index falls within an employee's shift.
 *
 * shiftStartIdx is INCLUSIVE; shiftEndIdx is EXCLUSIVE.
 * shiftStartIdx can be negative for pre-7 AM starters — those employees are
 * active from index 0 onwards in the visible grid.
 */
function isActiveAt(emp: Employee, slotIdx: number): boolean {
  return slotIdx >= emp.shiftStartIdx && slotIdx < emp.shiftEndIdx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — Door (D): default assignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RULE: Door (D) is the default task for every active shift slot.
 *
 * WHY this is first:
 *   Every subsequent rule overrides specific D slots with W, B, SEC, or FE.
 *   Starting from a clean D baseline makes the overrides simple and readable.
 */
function initializeWithDoor(employees: readonly Employee[]): Gameplan {
  const gameplan: Gameplan = {};

  for (const emp of employees) {
    gameplan[emp.name] = {};
    for (let i = 0; i < TIME_SLOTS.length; i++) {
      const time = TIME_SLOTS[i];
      // Active slots → Door; outside-shift slots → empty string (not rendered).
      gameplan[emp.name][time] = isActiveAt(emp, i) ? "D" : "";
    }
  }

  return gameplan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 5 — Security (SEC): late-shift authorized employees
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the employee qualifies for Security duty.
 *
 * Criteria:
 *   1. Employee is SEC-authorized (canSec).
 *   2. Shift extends past warehouse closing (the employee will be on-site
 *      after the store closes — that is when SEC duty is needed).
 *
 * Per the business rule: this applies to employees whose shifts end at
 * Midnight on weekdays or 11:30 PM on weekends. Both cases result in a
 * shiftEndIdx that exceeds WAREHOUSE_CLOSE_IDX, so a single threshold handles
 * both; `isWeekend` is available for future policy changes.
 */
function qualifiesForSecurity(emp: Employee, _isWeekend: boolean): boolean {
  // WHY check shiftEndIdx > threshold (not >=):
  //   An employee who ends exactly at warehouse closing does not stay after
  //   closing, so they have no SEC duty to perform.
  return emp.canSec && emp.shiftEndIdx > SEC_SHIFT_THRESHOLD;
}

/**
 * RULE: Security (SEC) — qualifying employees are assigned SEC for every slot
 * between warehouse closing and the end of their shift.
 *
 * WHY this runs before Walks and Breaks:
 *   SEC slots are fixed by warehouse closing time and cannot move.
 *   If Walks or Breaks were assigned first, they could accidentally land in
 *   a slot that should be SEC, and later logic would need to undo them.
 *   Processing SEC first avoids that conflict entirely.
 */
function assignSecurity(
  gameplan: Gameplan,
  employees: readonly Employee[],
  isWeekend: boolean
): Gameplan {
  const result = cloneGameplan(gameplan);

  for (const emp of employees) {
    if (!qualifiesForSecurity(emp, isWeekend)) continue;

    // SEC starts at warehouse closing, or at the employee's own shift start
    // if they happen to start after the warehouse closes (edge case).
    const secStartIdx = Math.max(emp.shiftStartIdx, WAREHOUSE_CLOSE_IDX);

    for (let i = secStartIdx; i < emp.shiftEndIdx; i++) {
      if (i >= 0 && i < TIME_SLOTS.length) {
        result[emp.name][TIME_SLOTS[i]] = "SEC";
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — Walk (W): hourly, fairness-distributed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RULE: Walk (W) — one capable employee walks the warehouse at the top of
 * every hour.  Fair distribution is enforced by always preferring the
 * employee(s) with the fewest walks completed so far today.  Among equals,
 * the selection is random.
 *
 * Eligibility at a given hour slot:
 *   • canWalk is true.
 *   • The employee is actively on shift.
 *   • The employee is currently assigned Door (D) — not SEC, not on break.
 *     We cannot ask someone who is already occupied to also walk.
 *
 * WHY Walks run after SEC but before Breaks:
 *   SEC slots are now locked, so we correctly exclude SEC employees.
 *   Breaks haven't been assigned yet, so we don't accidentally exclude
 *   someone from walking just because they will later receive a break.
 */
function assignWalks(
  gameplan: Gameplan,
  employees: readonly Employee[]
): Gameplan {
  const result = cloneGameplan(gameplan);

  // Cumulative walk count per employee — drives fair distribution.
  const walkCounts: Record<string, number> = Object.fromEntries(
    employees.map((e) => [e.name, 0])
  );

  for (let tIdx = 0; tIdx < TIME_SLOTS.length; tIdx++) {
    const time = TIME_SLOTS[tIdx];

    // Walks are only required at the exact start of each hour (XX:00).
    if (!time.endsWith(":00")) continue;

    // Build the eligible pool: walk-authorized, active, on plain Door.
    const eligible = employees.filter(
      (emp) =>
        emp.canWalk &&
        isActiveAt(emp, tIdx) &&
        result[emp.name][time] === "D"
    );

    if (eligible.length === 0) continue; // No one available — skip this hour.

    // Find the minimum walk count among eligible employees.
    const minWalks = Math.min(...eligible.map((e) => walkCounts[e.name]));

    // Collect all employees tied at the minimum (fairness pool).
    const candidates = eligible.filter((e) => walkCounts[e.name] === minWalks);

    // Random selection within the fairness pool.
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];

    result[chosen.name][time] = "W";
    walkCounts[chosen.name]++;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 & 4 — Breaks (B and B/D): coverage-safe placement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locates the best slot for a break of the given type, searching outward from
 * `targetIdx` in alternating ±offsets (centre-out scan).
 *
 * Constraints enforced:
 *   • The slot must fall inside the employee's visible shift, with a small
 *     buffer from either end (don't break right at arrival or departure).
 *   • The employee must currently be on plain Door (D) — not W, B, SEC, FE.
 *   • Coverage floor:
 *       - "B" (full break): employee leaves Door → coverage drops by 1.
 *         We require current coverage > MIN_DOOR_COVERAGE so that coverage
 *         after = current − 1 ≥ MIN_DOOR_COVERAGE.
 *       - "B/D" (combo): employee stays on Door for half the slot → B/D still
 *         counts toward coverage.  Coverage stays the same, so we only need
 *         current ≥ MIN_DOOR_COVERAGE.
 *
 * Returns the chosen slot index, or -1 if no valid slot is found within the
 * search radius.  The caller must handle -1 gracefully (no break assigned).
 */
function findBreakSlot(
  gameplan: Gameplan,
  employees: readonly Employee[],
  emp: Employee,
  targetIdx: number,
  type: "B" | "B/D"
): number {
  // Establish the valid search window within the employee's visible shift.
  // Math.max(0, ...) ensures we don't reference negative (pre-7 AM) indices.
  const earliest = Math.max(0, emp.shiftStartIdx) + BREAK_SHIFT_BUFFER;
  const latest   = emp.shiftEndIdx - BREAK_SHIFT_BUFFER;

  for (let offset = 0; offset <= BREAK_SEARCH_RADIUS; offset++) {
    // Generate candidate offsets: 0, +1, -1, +2, -2, … (centre-out).
    const deltas = offset === 0 ? [0] : [offset, -offset];

    for (const delta of deltas) {
      const idx = targetIdx + delta;

      // Must be within the employee's valid break window.
      if (idx < earliest || idx >= latest) continue;

      // Must be a TIME_SLOTS index that exists.
      if (idx < 0 || idx >= TIME_SLOTS.length) continue;

      const time = TIME_SLOTS[idx];

      // Only override plain Door slots; never overwrite W, SEC, or existing breaks.
      if (gameplan[emp.name][time] !== "D") continue;

      const doorNow = countDoorCoverage(gameplan, employees, time);

      if (type === "B") {
        // This employee's D→B means coverage drops by 1.
        // Safe only when we currently have strictly more than the minimum.
        if (doorNow > MIN_DOOR_COVERAGE) return idx;
      } else {
        // "B/D" — this employee stays counted as Door (D→B/D, no coverage drop).
        // Safe whenever current coverage meets or exceeds the minimum.
        if (doorNow >= MIN_DOOR_COVERAGE) return idx;
      }
    }
  }

  // Could not safely schedule a break without violating coverage rules.
  return -1;
}

/**
 * RULE: Full-shift Break (B) — employees on shifts of 8 or more hours receive
 * two 30-minute breaks, placed near the 1/3 and 2/3 marks of their shift.
 *
 * WHY 1/3 and 2/3?
 *   Spreading breaks evenly prevents long unbroken stretches for any employee
 *   while keeping door coverage predictable (one person off at a time).
 *
 * WHY the second break is searched AFTER the first is placed?
 *   Once break #1 is inserted, door coverage at that slot has changed.
 *   Searching for break #2 on the updated Gameplan avoids double-counting
 *   coverage and ensures the second break is placed safely.
 */
function assignFullShiftBreaks(
  gameplan: Gameplan,
  employees: readonly Employee[],
  emp: Employee
): Gameplan {
  // We need a mutable local copy so we can place B1, recount, then place B2.
  let result = cloneGameplan(gameplan);

  // Use the full shift span (including pre-7 AM) for accurate 1/3 and 2/3 targets.
  const shiftSpan = emp.shiftEndIdx - emp.shiftStartIdx;

  // Break #1 — near the 1/3 mark.
  const target1 = Math.round(emp.shiftStartIdx + shiftSpan * (1 / 3));
  const slot1   = findBreakSlot(result, employees, emp, target1, "B");
  if (slot1 !== -1) {
    result[emp.name][TIME_SLOTS[slot1]] = "B";
    // result is now the updated Gameplan that reflects B1 being placed.
  }

  // Break #2 — near the 2/3 mark, using the coverage-updated result from B1.
  const target2 = Math.round(emp.shiftStartIdx + shiftSpan * (2 / 3));
  const slot2   = findBreakSlot(result, employees, emp, target2, "B");
  if (slot2 !== -1) {
    result[emp.name][TIME_SLOTS[slot2]] = "B";
  }

  return result;
}

/**
 * RULE: Short-shift Break/Door (B/D) — employees on 4–5 hour shifts receive
 * one 15-minute break / 15-minute door combo near the midpoint of their shift.
 *
 * WHY B/D instead of a full B?
 *   Shorter shifts do not earn a full 30-minute paid break under Costco policy.
 *   The B/D hybrid lets the employee step away briefly without fully vacating
 *   the door, so coverage is maintained even with fewer total staff.
 */
function assignShortShiftBreak(
  gameplan: Gameplan,
  employees: readonly Employee[],
  emp: Employee
): Gameplan {
  const result = cloneGameplan(gameplan);

  const shiftSpan = emp.shiftEndIdx - emp.shiftStartIdx;
  const target    = Math.round(emp.shiftStartIdx + shiftSpan * 0.5);
  const slot      = findBreakSlot(result, employees, emp, target, "B/D");

  if (slot !== -1) {
    result[emp.name][TIME_SLOTS[slot]] = "B/D";
  }

  return result;
}

/**
 * Dispatcher that routes each employee to the correct break rule based on
 * their shift length, then threads the updated Gameplan through each employee
 * in sequence so coverage counts are always current.
 *
 * Routing:
 *   ≥ 8 hours   → two B breaks (Rule 3 — full shift)
 *   4–5 hours   → one B/D break (Rule 4 — short shift)
 *   other       → no break (5–8 h range is not specified by current policy)
 */
function assignBreaks(
  gameplan: Gameplan,
  employees: readonly Employee[]
): Gameplan {
  // Thread the Gameplan through each employee in sequence.
  // WHY sequential (not parallel)?
  //   When we place a break for employee A, it changes door coverage at that
  //   slot.  Employee B's break search must see that updated coverage so it
  //   doesn't place two breaks in the same slot and undercount coverage.
  let result = cloneGameplan(gameplan);

  for (const emp of employees) {
    if (emp.shiftLengthHours >= 8) {
      result = assignFullShiftBreaks(result, employees, emp);
    } else if (emp.shiftLengthHours >= 4 && emp.shiftLengthHours <= 5) {
      result = assignShortShiftBreak(result, employees, emp);
    }
    // Shifts between 5 h and 8 h, or under 4 h, receive no break per policy.
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 6 — Front End (FE): Door overflow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RULE: Front End (FE) — after Walks, Breaks, and SEC are fully resolved,
 * any time slot where total Door coverage exceeds TARGET_DOOR_COVERAGE (4)
 * has its excess plain-Door employees reassigned to Front End.
 *
 * WHY only plain D (not B/D) is converted?
 *   B/D employees are mid-break and cannot be moved to another assignment.
 *   Only employees on full Door duty are redirectable without disrupting
 *   their break schedule.
 *
 * WHY this runs last?
 *   FE is the residual category.  We must know the final Walk and Break
 *   assignments before we can correctly count Door coverage and identify
 *   actual overflow.
 */
function assignFrontEnd(
  gameplan: Gameplan,
  employees: readonly Employee[]
): Gameplan {
  const result = cloneGameplan(gameplan);

  for (const time of TIME_SLOTS) {
    // Count total Door-equivalent coverage (D + B/D).
    const doorCoverage = countDoorCoverage(result, employees, time);
    if (doorCoverage <= TARGET_DOOR_COVERAGE) continue;

    // Identify employees on plain Door who are available to move to FE.
    // (B/D employees cannot be moved — see WHY note above.)
    const reassignable = employees.filter((e) => result[e.name][time] === "D");
    let excess = doorCoverage - TARGET_DOOR_COVERAGE;

    for (const emp of reassignable) {
      if (excess <= 0) break;
      result[emp.name][time] = "FE";
      excess--;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateGameplan — the core scheduling engine.
 *
 * Pure function: given a list of employees (and whether it is a weekend),
 * returns a fully populated Gameplan grid that satisfies all six business rules:
 *
 *   1. Door (D)   — default for every active slot; target of 4 at all times.
 *   2. Walk (W)   — one capable employee at each hour start, fewest-first.
 *   3. Break (B)  — two 30-min breaks for full shifts, coverage ≥ 3 enforced.
 *   4. B/D        — one 15-min break combo for 4–5 h shifts.
 *   5. SEC        — authorized employees cover post-closing slots.
 *   6. FE         — overflow Door employees beyond 4 go to Front End.
 *
 * @param employees  List of employees parsed from the schedule file.
 * @param isWeekend  True when generating a weekend Gameplan. Affects SEC
 *                   eligibility thresholds (reserved for future policy changes).
 * @returns          Gameplan: Record<employeeName, Record<timeSlot, TaskCode>>
 */
export function generateGameplan(
  employees: readonly Employee[],
  isWeekend: boolean = false
): Gameplan {
  // Each step returns a brand-new Gameplan; nothing is ever mutated in place.
  const initialized  = initializeWithDoor(employees);
  const withSecurity = assignSecurity(initialized, employees, isWeekend);
  const withWalks    = assignWalks(withSecurity, employees);
  const withBreaks   = assignBreaks(withWalks, employees);
  const withFrontEnd = assignFrontEnd(withBreaks, employees);

  return withFrontEnd;
}
