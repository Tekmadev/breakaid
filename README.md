# BreakAid — Costco Gameplan Generator

A Next.js 16 web app that helps Costco managers auto-generate the daily 30-minute interval **Gameplan** for employees stationed at the warehouse Door (entry/exit). Upload the weekly schedule, configure who can do what, and let the engine assign Doors, Walks, Breaks, Security, and Front End coverage in one click.

## Stack

- **Next.js 16** (App Router) + **React 19**
- **TypeScript**
- **Tailwind v4** styling with a glassmorphism UI and official Costco brand colors (Red `#E31837`, Blue `#005DAA`)
- [`xlsx`](https://www.npmjs.com/package/xlsx) for client-side Excel/CSV parsing
- [`lucide-react`](https://lucide.dev) for icons

## Features

- **Drag-and-drop upload** of the weekly schedule (`.xlsx` / `.csv`)
- **Capabilities modal** — toggle per-employee certifications (Walks, Security)
- **Interactive grid** — employees on rows, 30-min slots on columns; click any cell to cycle task assignments
- **Auto-Generate engine** — assigns `D`, `W`, `B`, `B/D`, `SEC`, `FE` per Costco's staffing rules
- **CSV export** matching the official Costco Gameplan template

## Auto-Generate Rules

| Code | Meaning | Rule |
|------|---------|------|
| `D` | Door | Default for active shifts; target = 4 employees at all times |
| `W` | Walk | 1 capable employee at the top of every hour; fair rotation |
| `B` | Break | Full 8.5h shifts get two 30-min breaks near 1/3 and 2/3 marks |
| `B/D` | Break + Door | 4–5h shifts get a single 15/15 combo near mid-shift |
| `SEC` | Security | Authorized late-shift employees only (Midnight weekdays, 11:30 PM weekends) |
| `FE` | Front End | Overflow when Door > 4 and all Walks/Breaks are covered |

There is is also `IN` and `OUT` instead of `D`

> Coverage constraint: a break is never assigned if it would drop Door coverage below 3 people — the engine shifts it to the closest valid slot.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run start` — serve the production build
- `npm run lint` — run ESLint

## Roadmap

- Real row-by-row parser for Costco's specific weekly schedule format (currently mock data)
- Optional backend persistence for employee capabilities

## Notes

Sample input spreadsheets and exported gameplans are gitignored — they contain real employee data and must not be committed.
