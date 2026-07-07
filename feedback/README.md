# Feedback Capture (TEMPORARY)

> This folder is part of **temporary scaffolding** used to collect labeled
> training data for the BreakAid scheduling algorithm. It is safe to delete once
> the deterministic scheduling rules are finalized.

## What this folder is for

The BreakAid app has a **Feedback Mode** (a temporary, dashed-border toolbar
under the Gameplan Grid header). After a manager clicks **Auto Generate** and
then corrects cells in the grid, the app records each correction - the cell
change plus a structured reason and a free-text note - into a self-contained
JSON file called `breakaid-feedback.json`.

This folder is where you save those exported files.

## How to hand corrections to the developer

1. In the app, click **Auto Generate** to produce a baseline Gameplan.
2. Correct any cells you disagree with. Each change opens a short "Why did you
   change this?" dialog where you pick reasons and (optionally) explain.
3. In the **🧪 Feedback Mode (temporary)** toolbar, click **Export Feedback**.
4. Save the downloaded `breakaid-feedback.json` into **this `feedback/` folder**.

## Privacy / git

JSON files in this folder are **gitignored** (`/feedback/*.json`) because they
contain real employee names from the schedule. Do not commit them. Only this
`README.md` and `SCHEMA.md` are tracked.

## What the developer does with it

A developer with no access to the running app reads `breakaid-feedback.json` to
understand **why** each cell was changed away from the auto-generated baseline.
The structured `reasons`, `scope`, denormalized employee constraints, and the
`doorCoverageBefore` / `doorCoverageAfter` numbers are the labeled signal used
to design and tune a deterministic scheduling algorithm - so that future
Auto Generate runs already produce what the manager would have hand-corrected.

See [`SCHEMA.md`](./SCHEMA.md) for the full field-by-field structure and an
annotated example.
