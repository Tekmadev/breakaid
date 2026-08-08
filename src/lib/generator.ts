/**
 * generator.ts - Core scheduling engine for the BreakAid Gameplan (v2).
 *
 * This version encodes the real Costco door rules captured from the manager's
 * feedback. See the project memory "costco-scheduling-rules" for the source.
 *
 * Public API
 * ----------
 * generateGameplan(employees, isWeekend?) → Gameplan
 * computeHelpRow(gameplan, employees, isWeekend?) → Record<timeSlot, boolean>
 *   (the far-right "FE HELP" understaffing indicator, computed AFTER assignment)
 *
 * Execution order (matters - do not reorder)
 * ------------------------------------------
 * 1. initializeWithDoor - every active slot starts as Door (D, internal).
 * 2. assignSecurity - fixed by closing time; weekday = 1 guard, weekend = 2.
 * 3. assignBreaks - ≥6h → two 30-min breaks; <6h → one 15-min B/D.
 *                          MANDATORY: breaks override the coverage floor.
 *                          A security guard's last break sits right before SEC.
 *                          The OPENER's first break is pinned to 7:30.
 * 4. assignWalks - one per hour from 8:00 to the last-walk time (there
 *                          is no 7:00 walk); 8:00 → the opener, straight off
 *                          their 7:30 break; 11:00 → the 11-AM starter;
 *                          weekend 18:00 → guard 1; rest fair.
 * 5. assignPush - the 30-min slot right after close: keep ≥1 at the
 *                          exit door, rest → PUSH (cart pushing). People who
 *                          cannot work the front end are pushed FIRST, since
 *                          PUSH is the only post-close task open to them.
 * 6. assignFrontEnd - open-hours Door overflow (> target) → FE; and any
 *                          on-shift staff after the push window → FE. The
 *                          overflow goes to whoever has done the FEWEST front-end
 *                          slots today (never simply the first in roster order,
 *                          which is the earliest shift), and each trip lasts
 *                          ~1 hour unless the door cannot spare them that long.
 *                          canFE=false excludes someone from the OPEN-HOURS
 *                          overflow entirely; after close they push carts first
 *                          and only help at the front end once nothing else is
 *                          left.
 * 7. assignDoorSides - LAST: every remaining internal "D" becomes IN
 *                          (entrance) or OUT (exit). Split per slot: even count
 *                          → 50/50; odd count → the EXTRA person goes to the
 *                          EXIT (manager's rule: 3 on door = 1 IN / 2 OUT).
 *                          Rotation is fairness-first: ~1-hour stints
 *                          alternating sides, and after any interruption
 *                          (walk/break/FE) the person returns to whichever side
 *                          rebalances their own IN/OUT totals - so nobody can
 *                          camp on their preferred side. doorSide restrictions
 *                          ("in"-only / "out"-only) are always honoured, and
 *                          the 7:30 arrival always opens on OUT, covering the
 *                          exit while the opener takes their 7:30 break.
 *
 * Determinism: same inputs produce the same plan. Walk tie-breaks use a stable
 * order (fewest walks → roster order), so there is no randomness.
 */

import type { Employee, Gameplan, TaskCode } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Time grid
// ─────────────────────────────────────────────────────────────────────────────

/** 30-minute slots, index 0 = 7:00 AM … index 34 = midnight (0:00). */
export const TIME_SLOTS: readonly string[] = [
  "7:00",  "7:30",  "8:00",  "8:30",  "9:00",  "9:30",
  "10:00", "10:30", "11:00", "11:30", "12:00", "12:30",
  "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
  "19:00", "19:30", "20:00", "20:30", "21:00", "21:30",
  "22:00", "22:30", "23:00", "23:30", "0:00",
];

// Named slot indices used throughout the rules (all relative to TIME_SLOTS).
const IDX_730AM = 1;     // "7:30" - the opener's first break; the 7:30 arrival takes the EXIT
const IDX_8AM  = 2;      // "8:00" - the opener's walk, and the first walk of the day
const IDX_11AM = 8;      // "11:00" - the special "fresh arrival" walk hour
const IDX_6PM  = 22;     // "18:00" - weekend guard-1 usually takes this walk

// The day's first walk. There is deliberately no 7:00 walk: the opening shift
// starts at 5 AM and that person breaks at 7:30 then walks at 8:00 instead.
const FIRST_WALK_IDX = IDX_8AM;

// Door coverage policy.
const MIN_DOOR_COVERAGE = 3;     // floor (breaks may still override it)
const TARGET_DOOR_COVERAGE = 4;  // ideal; overflow beyond this goes to FE

// FE HELP (understaffing) - see computeHelpRow.
const HELP_AT_OR_BELOW = 2;          // ≤2 on the door during trading hours → needs help

// The warehouse opens to members at 9:00 EVERY day (TIME_SLOTS idx 4). Closing
// is per-day and lives in DayConfig (weekday 8:30 PM, weekend 7:00 PM).
const IDX_9AM = 4;
// Nobody rushes the door the moment it opens, so the alert only starts an hour
// after opening. Before that the store is shut or still quiet, and a thin door
// is expected rather than a problem.
const HELP_START_IDX = IDX_9AM + 2;  // 10:00

// PUSH cap - at most this many on cart-pushing in the post-close window.
const MAX_PUSH = 4;

// FE stint length - a front-end trip lasts ~1 hour (2 slots). It is cut short
// only when the door cannot spare the person for the second slot.
const FE_STINT_SLOTS = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Day configuration (weekday vs weekend)
// ─────────────────────────────────────────────────────────────────────────────

type DayConfig = {
  /** First CLOSED slot - the store entry closes at this slot's start time. */
  closeIdx: number;
  /** Security begins half an hour before close. */
  securityStartIdx: number;
  /** Last hourly walk happens at this slot (inclusive). */
  lastWalkIdx: number;
  /** The single 30-min slot of cart-pushing right after close. */
  pushIdx: number;
  /** Number of weekend security guards (1 on weekdays, 2 on weekends). */
  weekend: boolean;
};

/**
 * Weekday: entry closes 8:30 PM (idx 27), security 8:00 PM (26), last walk 9 PM (28).
 * Weekend: entry closes 7:00 PM (idx 24), security 6:30 PM (23), last walk 7 PM (24).
 * Security always starts the slot before close; PUSH is the close slot itself.
 */
function dayConfig(isWeekend: boolean): DayConfig {
  if (isWeekend) {
    return { closeIdx: 24, securityStartIdx: 23, lastWalkIdx: 24, pushIdx: 24, weekend: true };
  }
  return { closeIdx: 27, securityStartIdx: 26, lastWalkIdx: 28, pushIdx: 27, weekend: false };
}

/**
 * Auto-detect weekend vs weekday from the roster: a security-capable employee
 * who finishes at 11:30 PM (idx 33) signals a weekend; midnight (idx 34) a
 * weekday. Falls back to weekday. Callers may override with an explicit flag.
 */
export function detectIsWeekend(employees: readonly Employee[]): boolean {
  const latestSecEnd = employees
    .filter((e) => e.canSec)
    .reduce((max, e) => Math.max(max, e.shiftEndIdx), 0);
  // 23:30 == idx 33 (weekend close-out); anything earlier than midnight reads as weekend.
  return latestSecEnd > 0 && latestSecEnd <= 33;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function cloneGameplan(gameplan: Gameplan): Gameplan {
  const clone: Gameplan = {};
  for (const name in gameplan) clone[name] = { ...gameplan[name] };
  return clone;
}

function isActiveAt(emp: Employee, slotIdx: number): boolean {
  return slotIdx >= emp.shiftStartIdx && slotIdx < emp.shiftEndIdx;
}

/**
 * The opener: whoever is already on the door at 7:00, earliest start first.
 * The opening shift currently begins at 5 AM (a negative shiftStartIdx, which
 * the parser allows), but any shift starting at or before 7:00 counts, so this
 * keeps working if the opening time moves. Null on a day with no early shift,
 * in which case the opener rules simply do not fire.
 */
function identifyOpener(employees: readonly Employee[]): Employee | null {
  return employees.reduce<Employee | null>(
    (best, e) =>
      e.shiftStartIdx <= 0 && (best === null || e.shiftStartIdx < best.shiftStartIdx) ? e : best,
    null
  );
}

/**
 * May this person help at the Front End? Absent means yes, so rosters saved
 * before the flag existed keep working. It blocks the open-hours overflow only:
 * once the store has closed and the push window is over there is nothing else
 * left to do, so the post-close sweep still applies to everyone.
 */
function canWorkFrontEnd(emp: Employee): boolean {
  return emp.canFE !== false;
}

/**
 * Door-equivalent coverage at a slot - what counts as "on the door".
 * Counts IN + OUT (the final door codes), internal "D" (the pipeline's
 * pre-side placeholder, also present in legacy saved plans), and B/D.
 */
function countDoorCoverage(
  gameplan: Gameplan,
  employees: readonly Employee[],
  time: string
): number {
  let count = 0;
  for (const emp of employees) {
    const task = gameplan[emp.name]?.[time];
    if (task === "D" || task === "IN" || task === "OUT" || task === "B/D") count++;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 - Door (D): default
// ─────────────────────────────────────────────────────────────────────────────

function initializeWithDoor(employees: readonly Employee[]): Gameplan {
  const gameplan: Gameplan = {};
  for (const emp of employees) {
    gameplan[emp.name] = {};
    for (let i = 0; i < TIME_SLOTS.length; i++) {
      gameplan[emp.name][TIME_SLOTS[i]] = isActiveAt(emp, i) ? "D" : "";
    }
  }
  return gameplan;
}

// ─────────────────────────────────────────────────────────────────────────────
// Security guard identification
// ─────────────────────────────────────────────────────────────────────────────

type Guards = {
  /** Weekday single guard, or weekend "second" guard (covers until ~11:30 PM). */
  late: Employee | null;
  /** Weekend "first" guard - ends 7:30 PM, covers only their last hour. */
  early: Employee | null;
  /** Slot where the late guard's SEC duty begins (their 2nd break sits before it). */
  lateSecStartIdx: number;
  /** Slot where the early guard's SEC duty begins (weekend only). */
  earlySecStartIdx: number;
};

/**
 * Pick the security guard(s).
 *   Weekday → one guard: the security-capable employee who finishes latest.
 *   Weekend → two guards:
 *     • early = a canSec employee ending 7:30 PM (idx 25), preferring the
 *       11 AM–7:30 PM person; covers only their last hour (securityStart→7:30).
 *     • late  = the canSec employee finishing latest (~11:30 PM); covers from
 *       7:30 PM (the handoff) to end of shift.
 */
function identifyGuards(employees: readonly Employee[], cfg: DayConfig): Guards {
  const eligible = employees.filter((e) => e.canSec);
  const latest = eligible.reduce<Employee | null>(
    (best, e) => (best === null || e.shiftEndIdx > best.shiftEndIdx ? e : best),
    null
  );

  if (!cfg.weekend) {
    return { late: latest, early: null, lateSecStartIdx: cfg.securityStartIdx, earlySecStartIdx: -1 };
  }

  // Weekend: find the "first" guard - a canSec employee ending 7:30 PM (idx 25),
  // preferring the 11 AM starter; never the same person as the late guard.
  const endsAt730 = eligible.filter((e) => e.shiftEndIdx === 25 && e !== latest);
  const early =
    endsAt730.find((e) => e.shiftStartIdx === IDX_11AM) ?? endsAt730[0] ?? null;

  // The late guard hands off from the early guard's end (7:30 PM, idx 25); if
  // there is no early guard, the late guard covers from securityStart.
  const lateSecStartIdx = early ? 25 : cfg.securityStartIdx;
  return { late: latest, early, lateSecStartIdx, earlySecStartIdx: cfg.securityStartIdx };
}

function assignSecurity(
  gameplan: Gameplan,
  guards: Guards
): Gameplan {
  const result = cloneGameplan(gameplan);

  if (guards.early) {
    // Early guard covers their last hour only: securityStart → end of shift.
    for (let i = guards.earlySecStartIdx; i < guards.early.shiftEndIdx; i++) {
      if (i >= 0 && i < TIME_SLOTS.length) result[guards.early.name][TIME_SLOTS[i]] = "SEC";
    }
  }
  if (guards.late) {
    const start = Math.max(guards.late.shiftStartIdx, guards.lateSecStartIdx);
    for (let i = start; i < guards.late.shiftEndIdx; i++) {
      if (i >= 0 && i < TIME_SLOTS.length) result[guards.late.name][TIME_SLOTS[i]] = "SEC";
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Breaks (mandatory; coverage-aware placement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the best slot for a break near `targetIdx`, honouring the manager's rule
 * that breaks should sit close to their target (e.g. an earlier first break) at
 * a coverage-SAFE slot - not wherever coverage happens to be highest.
 *
 * Strategy: scan outward from the target (nearest first, earlier slot winning
 * ties) and take the first plain-Door slot meeting a coverage tier. We try the
 * "safe" tier first (door stays ≥ floor after the break), then relax. Breaks are
 * MANDATORY, so the last tier accepts any plain-Door slot. Returns -1 only when
 * no plain-Door slot exists in the window at all.
 */
function findBreakSlot(
  gameplan: Gameplan,
  employees: readonly Employee[],
  emp: Employee,
  targetIdx: number,
  radius: number,
  avoidIdx: number
): number {
  const earliest = Math.max(0, emp.shiftStartIdx) + 1; // not the very first slot
  const latest = emp.shiftEndIdx - 1;                  // not the very last slot

  // Acceptance tiers on CURRENT coverage: prefer slots where the door stays at
  // or above the floor after one person steps away, then progressively relax.
  const tiers = [TARGET_DOOR_COVERAGE, MIN_DOOR_COVERAGE, 0];

  for (const minCoverage of tiers) {
    for (let k = 0; k <= radius; k++) {
      // Nearest-first; on a tie the EARLIER slot (target − k) is tried first so
      // breaks lean earlier, matching the manager's spacing preference.
      const candidates = k === 0 ? [targetIdx] : [targetIdx - k, targetIdx + k];
      for (const idx of candidates) {
        if (idx < earliest || idx >= latest) continue;
        if (idx < 0 || idx >= TIME_SLOTS.length) continue;
        if (idx === avoidIdx) continue;
        const time = TIME_SLOTS[idx];
        if (gameplan[emp.name][time] !== "D") continue; // only convert plain Door
        if (countDoorCoverage(gameplan, employees, time) >= minCoverage) return idx;
      }
    }
  }
  return -1;
}

/**
 * Last-resort break slot when no plain-Door slot is available: breaks outrank
 * walks, so displace the nearest interior Walk (SEC is never displaced). Returns
 * -1 only if the whole interior is locked by SEC.
 */
function findDisplaceableWalkSlot(
  gameplan: Gameplan,
  emp: Employee,
  targetIdx: number,
  avoidIdx: number
): number {
  const earliest = Math.max(0, emp.shiftStartIdx) + 1;
  const latest = emp.shiftEndIdx - 1;
  let best = -1;
  let bestDistance = Infinity;
  for (let idx = earliest; idx < latest; idx++) {
    if (idx === avoidIdx || idx < 0 || idx >= TIME_SLOTS.length) continue;
    if (gameplan[emp.name][TIME_SLOTS[idx]] !== "W") continue;
    const distance = Math.abs(idx - targetIdx);
    if (distance < bestDistance) { best = idx; bestDistance = distance; }
  }
  return best;
}

/**
 * Place ONE break of `code` for `emp` near `target`, GUARANTEEING placement for
 * mandatory breaks: try the coverage-aware window first, then the whole shift,
 * then displace a walk. Returns the slot used, or -1 only if the entire interior
 * is SEC. Writes the cell on success.
 */
function placeBreak(
  result: Gameplan,
  employees: readonly Employee[],
  emp: Employee,
  target: number,
  avoidIdx: number,
  code: TaskCode
): number {
  let idx = findBreakSlot(result, employees, emp, target, 5, avoidIdx);
  if (idx === -1) idx = findBreakSlot(result, employees, emp, target, TIME_SLOTS.length, avoidIdx);
  if (idx === -1) idx = findDisplaceableWalkSlot(result, emp, target, avoidIdx);
  if (idx !== -1) result[emp.name][TIME_SLOTS[idx]] = code;
  return idx;
}

/**
 * Assign breaks for one employee, threading the updated plan back out.
 *   ≥6h → two 30-min breaks (B), MANDATORY (always placed; breaks outrank walks
 *         and the coverage floor). First a touch earlier than 1/3 for spacing.
 *   <6h → one 15-min break/door combo (B/D) near the midpoint.
 * For a security guard, the 2nd break is pinned right before SEC; the first
 * break then bisects the pre-security stretch so the pair stays balanced.
 */
function assignBreaksFor(
  gameplan: Gameplan,
  employees: readonly Employee[],
  emp: Employee,
  pinnedSecondBreakIdx: number | null,
  pinnedFirstBreakIdx: number | null
): Gameplan {
  const result = cloneGameplan(gameplan);
  const span = emp.shiftEndIdx - emp.shiftStartIdx;

  /** Take exactly this slot when it is still plain Door, else the nearest fit. */
  const pinAt = (idx: number, avoid: number): number => {
    const t = TIME_SLOTS[idx];
    if (t !== undefined && result[emp.name][t] === "D") {
      result[emp.name][t] = "B";
      return idx;
    }
    return placeBreak(result, employees, emp, idx, avoid, "B");
  };

  if (emp.shiftLengthHours >= 6) {
    // For a guard, place the pinned 2nd break (right before security) FIRST so
    // the first break can bisect the remaining pre-security stretch.
    let pinnedSlot = -1;
    if (pinnedSecondBreakIdx !== null) pinnedSlot = pinAt(pinnedSecondBreakIdx, -1);

    // Break 1 - pinned for the opener (7:30, so they are back for the 8:00
    // walk); otherwise bisect the pre-security stretch when the 2nd break is
    // pinned, else ~0.28 (a bit earlier than 1/3 for spacing).
    let slot1: number;
    if (pinnedFirstBreakIdx !== null) {
      slot1 = pinAt(pinnedFirstBreakIdx, pinnedSlot);
    } else {
      const target1 = pinnedSlot !== -1
        ? Math.round((Math.max(0, emp.shiftStartIdx) + pinnedSlot) / 2)
        : Math.round(emp.shiftStartIdx + span * 0.28);
      slot1 = placeBreak(result, employees, emp, target1, pinnedSlot, "B");
    }

    // Break 2 for non-guards - near 2/3 (the guard's 2nd break is the pin above).
    if (pinnedSecondBreakIdx === null) {
      const target2 = Math.round(emp.shiftStartIdx + span * 0.66);
      placeBreak(result, employees, emp, target2, slot1, "B");
    }
  } else {
    // Short shift - a single 15-min break/door combo near the midpoint.
    const target = Math.round(emp.shiftStartIdx + span * 0.5);
    placeBreak(result, employees, emp, target, -1, "B/D");
  }

  return result;
}

function assignBreaks(
  gameplan: Gameplan,
  employees: readonly Employee[],
  guards: Guards,
  opener: Employee | null
): Gameplan {
  let result = cloneGameplan(gameplan);
  for (const emp of employees) {
    // The late/weekday guard takes their 2nd break right before SEC begins.
    let pinnedSecond: number | null = null;
    if (guards.late && emp.name === guards.late.name) {
      pinnedSecond = guards.lateSecStartIdx - 1;
    }
    // The opener started at 5 AM, so their first break lands at 7:30 - which is
    // also what frees the exit door for the 7:30 arrival, and puts them back on
    // the floor in time for the 8:00 walk.
    const pinnedFirst = opener && emp.name === opener.name ? IDX_730AM : null;
    result = assignBreaksFor(result, employees, emp, pinnedSecond, pinnedFirst);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Walks (hourly; 11 AM special, weekend 6 PM → guard 1, rest fair)
// ─────────────────────────────────────────────────────────────────────────────

function assignWalks(
  gameplan: Gameplan,
  employees: readonly Employee[],
  cfg: DayConfig,
  guards: Guards,
  opener: Employee | null
): Gameplan {
  const result = cloneGameplan(gameplan);
  const walkCounts: Record<string, number> = Object.fromEntries(
    employees.map((e) => [e.name, 0])
  );

  const isFreeDoor = (emp: Employee, time: string) => result[emp.name][time] === "D";
  // Guards already get special walks (11 AM / 6 PM) plus security duty, so they
  // are de-prioritised for the regular hourly walks to keep distribution fair.
  const guardNames = new Set(
    [guards.early?.name, guards.late?.name].filter((n): n is string => Boolean(n))
  );

  for (let tIdx = FIRST_WALK_IDX; tIdx <= cfg.lastWalkIdx && tIdx < TIME_SLOTS.length; tIdx++) {
    const time = TIME_SLOTS[tIdx];
    if (!time.endsWith(":00")) continue; // walks only at the top of the hour

    // Special 0 - the 8 AM walk belongs to the opener, straight off their 7:30
    // break. They have been on the door since 5 AM, so it is theirs by right.
    if (tIdx === IDX_8AM && opener) {
      if (opener.canWalk && isFreeDoor(opener, time)) {
        result[opener.name][time] = "W";
        walkCounts[opener.name]++;
        continue;
      }
    }

    // Special 1 - the 11 AM walk goes to whoever's shift starts at 11.
    if (tIdx === IDX_11AM) {
      const starter = employees.find(
        (e) => e.shiftStartIdx === IDX_11AM && e.canWalk && isFreeDoor(e, time)
      );
      if (starter) {
        result[starter.name][time] = "W";
        walkCounts[starter.name]++;
        continue;
      }
    }

    // Special 2 - weekend 6 PM walk goes to the early guard if available.
    if (cfg.weekend && tIdx === IDX_6PM && guards.early) {
      const g1 = guards.early;
      if (g1.canWalk && isFreeDoor(g1, time)) {
        result[g1.name][time] = "W";
        walkCounts[g1.name]++;
        continue;
      }
    }

    // Default - fewest walks first, stable roster-order tie-break (no randomness).
    const eligible = employees.filter(
      (e) => e.canWalk && isActiveAt(e, tIdx) && isFreeDoor(e, time)
    );
    if (eligible.length === 0) continue;
    const minWalks = Math.min(...eligible.map((e) => walkCounts[e.name]));
    const tied = eligible.filter((e) => walkCounts[e.name] === minWalks);
    // Prefer a non-guard among the fewest-walked; fall back to roster order.
    const chosen = tied.find((e) => !guardNames.has(e.name)) ?? tied[0];
    result[chosen.name][time] = "W";
    walkCounts[chosen.name]++;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUSH (the 30-min slot right after close)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * At the close slot, the entry is shut but the exit stays open ~30 min: keep
 * ONE person on the door (D) as the exit-door attendant, leave any SEC/W/break
 * as-is, and send everyone else still on shift to PUSH (cart pushing), capped at
 * MAX_PUSH. (Anything beyond the push window is handled by assignFrontEnd.)
 */
function assignPush(
  gameplan: Gameplan,
  employees: readonly Employee[],
  cfg: DayConfig
): Gameplan {
  const result = cloneGameplan(gameplan);
  const time = TIME_SLOTS[cfg.pushIdx];
  if (time === undefined) return result;

  // Plain-Door people present in the close slot are the movable pool.
  const onDoor = employees.filter((e) => result[e.name][time] === "D");
  if (onDoor.length === 0) return result;

  // Keep one at the exit door. Hard rule: never an entrance-only (doorSide
  // "in") person. Soft preference: someone who CAN work the front end, because
  // the keeper's next stop once the push window ends is the front end anyway -
  // so holding back a front-end-capable person leaves the push slots for the
  // people who have nowhere else to go.
  const exitOk = onDoor.filter((e) => (e.doorSide ?? "both") !== "in");
  const keeper = exitOk.find(canWorkFrontEnd) ?? exitOk[0] ?? onDoor[0];

  // Everyone else pushes carts, capped at MAX_PUSH. Anyone who cannot work the
  // front end goes FIRST: PUSH is the only post-close task open to them.
  // (sort is stable, so equal candidates keep roster order and stay deterministic.)
  const pushPool = onDoor
    .filter((e) => e.name !== keeper.name)
    .sort((a, b) => Number(canWorkFrontEnd(a)) - Number(canWorkFrontEnd(b)));

  let pushed = 0;
  for (const emp of pushPool) {
    if (pushed >= MAX_PUSH) break;
    result[emp.name][time] = "PUSH";
    pushed++;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Front End (open-hours overflow + post-push leftover)
// ─────────────────────────────────────────────────────────────────────────────

/** Per-person front-end bookkeeping used while sweeping the day slot by slot. */
type FeState = {
  count: number;    // total FE slots this person has done today (fair share)
  run: number;      // consecutive slots in the CURRENT front-end stint
  lastIdx: number;  // slot index of their most recent FE assignment
  doorRun: number;  // consecutive slots they have stood on the door
};

/**
 * Front End - who covers the overflow, and for how long.
 *
 * Open hours: whenever the door holds more people than the target, the extras
 * help at the front end. Two manager rules decide WHO goes and HOW LONG:
 *   • Fair share - the person with the FEWEST front-end slots so far goes next.
 *     The roster is sorted by shift start, so the old "first match in roster
 *     order" pick sent the early shifts to the front end all day while the late
 *     shifts never went at all.
 *   • Whole stints - once someone is sent they stay ~1 hour. A stint is cut to
 *     half an hour only when the door genuinely cannot spare them for the second
 *     slot (coverage would fall under the floor) or their shift ends first.
 *   • Only front-end-capable people (see canWorkFrontEnd). Someone flagged
 *     canFE=false stays on the door instead, even if that keeps it over target.
 *
 * After the push window: anyone still on plain Door helps Front End - including
 * canFE=false people, because the door is shut and the carts are done, so there
 * is genuinely nothing else left (manager's call).
 *
 * Still fully deterministic: every tie-break below is a stable ordering.
 */
function assignFrontEnd(
  gameplan: Gameplan,
  employees: readonly Employee[],
  cfg: DayConfig
): Gameplan {
  const result = cloneGameplan(gameplan);

  const fe: Record<string, FeState> = Object.fromEntries(
    employees.map((e) => [e.name, { count: 0, run: 0, lastIdx: -99, doorRun: 0 }])
  );
  const rosterIdx = new Map(employees.map((e, i) => [e.name, i]));

  const sendToFrontEnd = (emp: Employee, tIdx: number) => {
    result[emp.name][TIME_SLOTS[tIdx]] = "FE";
    const s = fe[emp.name];
    s.run = s.lastIdx === tIdx - 1 ? s.run + 1 : 1;
    s.lastIdx = tIdx;
    s.count++;
  };

  for (let tIdx = 0; tIdx < TIME_SLOTS.length; tIdx++) {
    const time = TIME_SLOTS[tIdx];
    const onDoor = () => employees.filter((e) => result[e.name][time] === "D");
    // Open-hours overflow only ever considers front-end-capable people; anyone
    // else simply stays on the door, even if that leaves it above target.
    const overflowPool = () => onDoor().filter(canWorkFrontEnd);

    if (tIdx < cfg.closeIdx) {
      let coverage = countDoorCoverage(result, employees, time);

      // 1) Let unfinished stints reach their hour, unless the door needs them
      //    back - then it stays a half-hour trip.
      for (const emp of overflowPool()) {
        const s = fe[emp.name];
        if (s.lastIdx !== tIdx - 1 || s.run >= FE_STINT_SLOTS) continue;
        if (coverage - 1 < MIN_DOOR_COVERAGE) break;
        sendToFrontEnd(emp, tIdx);
        coverage--;
      }

      // 2) Send whoever is still over the target, fairest turn first.
      while (coverage > TARGET_DOOR_COVERAGE) {
        const candidates = overflowPool();
        if (candidates.length === 0) break;
        // Free for the SECOND half of the hour too? Someone who is already due a
        // break or a walk next slot can only manage a half-hour trip, so they go
        // last among people with the same number of trips.
        const nextTime = TIME_SLOTS[tIdx + 1];
        const canFinishHour = (e: Employee) =>
          nextTime !== undefined && result[e.name][nextTime] === "D" ? 0 : 1;
        candidates.sort((a, b) => {
          const sa = fe[a.name];
          const sb = fe[b.name];
          // Fewest trips so far; then whoever can still finish a full hour;
          // then whoever has stood on the door longest; then roster order.
          return (
            sa.count - sb.count ||
            canFinishHour(a) - canFinishHour(b) ||
            sb.doorRun - sa.doorRun ||
            (rosterIdx.get(a.name) ?? 0) - (rosterIdx.get(b.name) ?? 0)
          );
        });
        sendToFrontEnd(candidates[0], tIdx);
        coverage--;
      }
    } else if (tIdx > cfg.pushIdx) {
      // After the push window: anyone still on plain Door helps Front End.
      for (const emp of onDoor()) result[emp.name][time] = "FE";
    }

    // Roll each person's door streak forward for the next slot's tie-break.
    for (const emp of employees) {
      const task = result[emp.name][time];
      const s = fe[emp.name];
      s.doorRun = task === "D" || task === "B/D" ? s.doorRun + 1 : 0;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Door sides - IN (entrance) / OUT (exit), fair hourly rotation
// ─────────────────────────────────────────────────────────────────────────────

/** Per-person rotation memory used while sweeping the day slot by slot. */
type SideState = {
  in: number;        // total 30-min slots spent at the entrance so far
  out: number;       // total 30-min slots spent at the exit so far
  last: "IN" | "OUT" | null; // side of their most recent door stint
  lastIdx: number;   // slot index of their most recent door assignment
  stint: number;     // consecutive slots on `last` side (resets on interruption)
};

/** ~1 hour = 2 slots: the natural stint length before swapping sides. */
const STINT_SLOTS = 2;

/**
 * Final pass - convert every remaining internal "D" cell into IN or OUT.
 *
 * Per-slot split (manager's rule): exit gets the extra when odd.
 *   4 → 2 IN / 2 OUT · 3 → 1 IN / 2 OUT · 2 → 1 / 1 · 1 → OUT.
 * After the entry closes, everyone left on the door is OUT (exit only).
 *
 * Per-person rotation (fairness-first): stay on a side for ~1 hour, then swap;
 * after an interruption (walk, break, FE…) return on whichever side rebalances
 * that person's own IN/OUT totals. doorSide "in"/"out" restrictions are hard
 * constraints and shift the flexible quota (exit absorbs the slack).
 */
function assignDoorSides(
  gameplan: Gameplan,
  employees: readonly Employee[],
  cfg: DayConfig
): Gameplan {
  const result = cloneGameplan(gameplan);
  const state: Record<string, SideState> = Object.fromEntries(
    employees.map((e) => [e.name, { in: 0, out: 0, last: null, lastIdx: -99, stint: 0 }])
  );

  const commit = (emp: Employee, tIdx: number, side: "IN" | "OUT") => {
    result[emp.name][TIME_SLOTS[tIdx]] = side;
    const s = state[emp.name];
    s.stint = s.last === side && s.lastIdx === tIdx - 1 ? s.stint + 1 : 1;
    s.last = side;
    s.lastIdx = tIdx;
    if (side === "IN") s.in++;
    else s.out++;
  };

  for (let tIdx = 0; tIdx < TIME_SLOTS.length; tIdx++) {
    const time = TIME_SLOTS[tIdx];
    const onDoor = employees.filter((e) => result[e.name][time] === "D");
    if (onDoor.length === 0) continue;

    // Entry closed → the door IS the exit. (Restrictions still win: an
    // entrance-only person should never be here thanks to assignPush, but if a
    // manager edit puts them here, keep them IN rather than break the rule.)
    if (tIdx >= cfg.closeIdx) {
      for (const emp of onDoor) {
        commit(emp, tIdx, (emp.doorSide ?? "both") === "in" ? "IN" : "OUT");
      }
      continue;
    }

    // Hard restrictions first; they shift the flexible quotas.
    const forcedIn = onDoor.filter((e) => (e.doorSide ?? "both") === "in");
    const forcedOut = onDoor.filter((e) => (e.doorSide ?? "both") === "out");
    const flexible = onDoor.filter((e) => (e.doorSide ?? "both") === "both");
    for (const emp of forcedIn) commit(emp, tIdx, "IN");
    for (const emp of forcedOut) commit(emp, tIdx, "OUT");

    // Quotas on the whole door group: IN = floor(n/2), the extra goes OUT.
    const inQuota = Math.floor(onDoor.length / 2);
    let inLeft = Math.min(Math.max(0, inQuota - forcedIn.length), flexible.length);
    let outLeft = flexible.length - inLeft;

    // Each flexible person's desired side + how strongly they want it:
    //   3 - mid-stint (< 1h on this side, uninterrupted): keep the side.
    //   2 - stint complete: swap sides.
    //   1 - fresh/returning from interruption: pick the side that rebalances
    //       their own totals (tie → opposite of last side, else OUT).
    const opposite = (s: "IN" | "OUT"): "IN" | "OUT" => (s === "IN" ? "OUT" : "IN");
    const wishes = flexible.map((emp, rosterIdx) => {
      const s = state[emp.name];
      let desired: "IN" | "OUT";
      let strength: number;
      if (s.last && s.lastIdx === tIdx - 1 && s.stint < STINT_SLOTS) {
        desired = s.last;
        strength = 3;
      } else if (s.last && s.lastIdx === tIdx - 1) {
        desired = opposite(s.last);
        strength = 2;
      } else {
        desired =
          s.in < s.out ? "IN" : s.in > s.out ? "OUT" : s.last ? opposite(s.last) : "OUT";
        strength = 1;
      }
      // The 7:30 arrival is covering the EXIT for the opener, who goes on their
      // first break at exactly 7:30. So their very first door slot is always
      // OUT, never IN - top priority, so they claim it before anyone else.
      if (emp.shiftStartIdx === IDX_730AM && s.last === null) {
        desired = "OUT";
        strength = 4;
      }
      const imbalance = Math.abs(s.in - s.out);
      return { emp, desired, strength, imbalance, rosterIdx };
    });

    // Strongest wishes first; bigger personal imbalance breaks ties; roster
    // order keeps it deterministic.
    wishes.sort(
      (a, b) => b.strength - a.strength || b.imbalance - a.imbalance || a.rosterIdx - b.rosterIdx
    );
    for (const w of wishes) {
      let side: "IN" | "OUT" = w.desired;
      if (side === "IN" && inLeft === 0) side = "OUT";
      if (side === "OUT" && outLeft === 0) side = "IN";
      if (side === "IN") inLeft--;
      else outLeft--;
      commit(w.emp, tIdx, side);
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// FE HELP indicator (far-right column, computed last)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-slot understaffing flag for the far-right "FE HELP" column: a slot needs
 * help when the door is down to 2 people or fewer.
 *
 * It only applies during TRADING hours, from an hour after opening (10:00) up
 * to closing. Outside that it never flags:
 *   • Before 10:00 the store is either shut or has just opened, so a thin door
 *     is normal, not a problem. The alert used to start at 7:00 and lit up the
 *     whole early morning.
 *   • At closing the entrance shuts. Only the exit still needs someone, and
 *     assignPush already guarantees that keeper, so there is nothing to flag.
 * Slots with nobody on shift never flag either.
 */
export function computeHelpRow(
  gameplan: Gameplan,
  employees: readonly Employee[],
  isWeekend: boolean = false
): Record<string, boolean> {
  const cfg = dayConfig(isWeekend);
  const help: Record<string, boolean> = {};

  for (let tIdx = 0; tIdx < TIME_SLOTS.length; tIdx++) {
    const time = TIME_SLOTS[tIdx];
    help[time] = false;
    if (tIdx < HELP_START_IDX) continue;  // shut, or only just opened
    if (tIdx >= cfg.closeIdx) continue;   // entrance closed

    const anyoneActive = employees.some((e) => isActiveAt(e, tIdx));
    if (!anyoneActive) continue;

    if (countDoorCoverage(gameplan, employees, time) <= HELP_AT_OR_BELOW) {
      help[time] = true;
    }
  }
  return help;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateGameplan - the v2 scheduling engine.
 *
 * @param employees  Roster parsed from the schedule.
 * @param isWeekend  Weekend vs weekday ruleset. If omitted, auto-detected from
 *                   the roster (a canSec employee ending 11:30 PM → weekend).
 */
export function generateGameplan(
  employees: readonly Employee[],
  isWeekend?: boolean
): Gameplan {
  const weekend = isWeekend ?? detectIsWeekend(employees);
  const cfg = dayConfig(weekend);
  const guards = identifyGuards(employees, cfg);
  const opener = identifyOpener(employees);

  const withDoor     = initializeWithDoor(employees);
  const withSecurity = assignSecurity(withDoor, guards);
  const withBreaks   = assignBreaks(withSecurity, employees, guards, opener);
  const withWalks    = assignWalks(withBreaks, employees, cfg, guards, opener);
  const withPush     = assignPush(withWalks, employees, cfg);
  const withFrontEnd = assignFrontEnd(withPush, employees, cfg);
  const withSides    = assignDoorSides(withFrontEnd, employees, cfg);

  return withSides;
}
