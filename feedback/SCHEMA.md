# `breakaid-feedback.json` Schema (TEMPORARY)

> Temporary scaffolding for algorithm training. Safe to delete once the
> deterministic scheduling rules are finalized.

The exported file is a single JSON object of type `FeedbackSession`. It is
**self-contained**: the baseline plan, the roster, and every correction (with
denormalized employee constraints) are all present, so a developer can
reconstruct each decision without the running app.

---

## `FeedbackSession` (top-level object)

| Field               | Type           | Meaning                                                                                  |
| ------------------- | -------------- | ---------------------------------------------------------------------------------------- |
| `sessionId`         | `string`       | Unique id for this baseline (`crypto.randomUUID`); stamped onto every correction.         |
| `generatedAt`       | `string`       | ISO-8601 timestamp of when the baseline Gameplan was auto-generated.                      |
| `isWeekend`         | `boolean`      | Intended to flag weekend SEC rules. **Currently always `false`** — no UI toggle yet, and the generator does not branch on it. Treat as unreliable. |
| `timeSlots`         | `string[]`     | Canonical 30-min slot labels, index-aligned with every `slotIdx` and the shift indices. Index `0` = `"7:00"` … last = `"0:00"`. A negative shift index counts back from index 0 (pre-7AM). |
| `coverageRule`      | `object`       | `{ definition: string; min: number; target: number }` — what counts as door coverage, the floor (`min`, 3), and the target (4).|
| `roster`            | `Employee[]`   | Deep snapshot of the employees the baseline was generated from. See **Employee** below.   |
| `generatedGameplan` | `Gameplan`     | The auto-generated baseline, BEFORE any corrections. `Record<empName, Record<time, code>>`.|
| `corrections`       | `Correction[]` | Every correction made against the baseline, in `sequence` order. See **Correction** below. |

### `Employee` (one entry in `roster`)

| Field             | Type      | Meaning                                                            |
| ----------------- | --------- | ------------------------------------------------------------------ |
| `name`            | `string`  | Display name, e.g. `"Jen L"`.                                      |
| `shift`           | `string`  | Human-readable shift label, e.g. `"750-1620"`.                    |
| `canWalk`         | `boolean` | Authorized to perform Walk (W).                                    |
| `canSec`          | `boolean` | Authorized to perform Security (SEC).                              |
| `shiftStartIdx`   | `number`  | Inclusive start index into `TIME_SLOTS` (may be negative pre-7AM). |
| `shiftEndIdx`     | `number`  | Exclusive end index into `TIME_SLOTS`.                             |
| `shiftLengthHours`| `number`  | Total shift duration in hours, e.g. `8.5` or `5`.                 |

### `Gameplan`

`Record<employeeName, Record<timeSlot, TaskCode>>`. Task codes:
`""` (outside shift / empty), `"D"` (Door), `"W"` (Walk), `"B"` (Break),
`"B/D"` (Break+Door combo), `"SEC"` (Security), `"FE"` (Front End), and the
temporary `"FE HELP"` (Door short-handed — needs help; never emitted by the
generator, only ever set by a manual correction).

---

## `Correction` (one entry in `corrections`)

| Field                      | Type                 | Meaning                                                                                 |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `id`                       | `string`             | Stable unique id (`crypto.randomUUID`).                                                  |
| `sessionId`                | `string`             | The `FeedbackSession.sessionId` this correction belongs to.                             |
| `sequence`                 | `number`             | Monotonic 0-based ordinal. **Replay corrections in ascending `sequence`** — not by `timestamp`. |
| `labeled`                  | `boolean`            | `true` = manager picked ≥1 reason (Save). `false` = kept without a reason (Skip).        |
| `timestamp`                | `string`             | ISO-8601 time the correction was recorded.                                              |
| `employeeName`             | `string`             | Employee whose cell was edited.                                                         |
| `employeeShift`            | `string`             | That employee's shift label (denormalized from the roster).                             |
| `employeeShiftLengthHours` | `number`             | That employee's shift length in hours (denormalized).                                   |
| `employeeCanWalk`          | `boolean`            | Whether the employee is Walk-authorized (denormalized).                                 |
| `employeeCanSec`           | `boolean`            | Whether the employee is Security-authorized (denormalized).                             |
| `time`                     | `string`             | Time slot label of the edited cell, e.g. `"13:30"`.                                    |
| `slotIdx`                  | `number`             | Index of the edited cell in `TIME_SLOTS`.                                                |
| `oldTask`                  | `string`             | Task code before the change (`""` = empty).                                            |
| `newTask`                  | `string`             | Task code after the change (`""` = cleared).                                            |
| `reasons`                  | `CorrectionReason[]` | One or more structured reasons (see below).                                             |
| `scope`                    | `CorrectionScope`    | How broadly the manager wants the change applied (see below).                           |
| `note`                     | `string`             | Free-text explanation in the manager's own words (may be empty).                        |
| `doorCoverageBefore`       | `number`             | Door-equivalent (`D`/`B/D`) count at `time` BEFORE this change — **cumulative** (reflects all lower-`sequence` corrections already applied), not baseline-relative. |
| `doorCoverageAfter`        | `number`             | Door-equivalent (`D`/`B/D`) count at `time` AFTER this change.                           |

> **Replaying corrections.** Start from `generatedGameplan`, then apply each
> correction in ascending `sequence` order: set `gameplan[employeeName][time] = newTask`.
> The result reproduces the manager's final grid. Because coverage numbers are
> cumulative, they only line up if you replay in `sequence` order.
>
> **A moved break** appears as two corrections — a cell cleared (`"B" → ""` or
> `"B" → "D"`) and another set (`"" → "B"` or `"D" → "B"`), usually adjacent in
> `sequence` and sharing a reason like `break-too-late`. Detect moves by diffing
> the baseline against the replayed grid per employee.
>
> **`labeled: false`** (Skip) corrections still change the grid but carry no
> reason — include them in replay, ignore them for rule-mining. Edits the
> manager undid (Cancel/Esc) are never recorded.

### `CorrectionReason` (string union; `reasons` is an array of these)

| Value                | Manager-facing label              |
| -------------------- | --------------------------------- |
| `break-too-late`     | Break too late                    |
| `break-too-early`    | Break too early                   |
| `breaks-bunched`     | Breaks bunched together           |
| `need-help-at-door`  | Needs help at door (FE HELP)      |
| `keep-on-door`       | Keep on door                      |
| `wrong-walk`         | Wrong walk pick                   |
| `coverage-problem`   | Coverage problem                  |
| `wrong-person-sec`   | Wrong person on Security          |
| `other`              | Other                             |

### `CorrectionScope` (string union; single value)

| Value            | Manager-facing label        | Meaning                                  |
| ---------------- | --------------------------- | ---------------------------------------- |
| `once`           | Just this once              | One-off tweak for this specific plan.    |
| `employee`       | Always for this employee    | A standing preference for this person.   |
| `similar-shifts` | All similar shifts          | Generalizes to shifts of the same shape. |
| `everyone`       | Everyone                    | A global rule the algorithm should learn.|

---

## Annotated example `Correction`

The auto-generator put **Jen L** (a full 8.5h shift, Walk-authorized) on a
**Break (`B`) at 13:30**. The manager felt that break landed too late in the
day and moved her back to **Door (`D`)**. Door coverage at 13:30 went from 3
(at the floor) up to 4 once Jen rejoined the door.

```jsonc
{
  "id": "f1c2e3a4-5b6c-7d8e-9f01-23456789abcd", // crypto.randomUUID()
  "sessionId": "9a8b7c6d-...",                   // ties back to the baseline
  "sequence": 0,                                 // first correction this session
  "labeled": true,                               // manager picked a reason (Save)
  "timestamp": "2026-06-15T18:42:09.512Z",       // when the manager saved it
  "employeeName": "Jen L",
  "employeeShift": "750-1620",                   // denormalized from roster
  "employeeShiftLengthHours": 8.5,               // full shift → earns two B breaks
  "employeeCanWalk": true,
  "employeeCanSec": false,
  "time": "13:30",                               // the edited cell
  "slotIdx": 13,                                 // TIME_SLOTS[13] === "13:30"
  "oldTask": "B",                                // generator had placed a Break here
  "newTask": "D",                                // manager moved her back to Door
  "reasons": ["break-too-late"],                 // structured label for the developer
  "scope": "employee",                           // "Always for this employee"
  "note": "Jen's first break should be closer to 11, not mid-afternoon.",
  "doorCoverageBefore": 3,                        // only 3 on the door while she was on B
  "doorCoverageAfter": 4                          // back to a healthy 4 after the fix
}
```

**Reading the signal:** the generator's 1/3 break target put Jen's break "too
late" in the manager's judgment, and the manager wants this to hold for Jen
specifically (`scope: "employee"`). The coverage delta (`3 → 4`) confirms the
change also improved door staffing. A deterministic algorithm could learn to
bias break placement earlier for this shift shape.
