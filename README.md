# BreakAid

Costco member-service gameplan tool — automates the daily scheduling of door, walk, break, front-end, and security assignments.

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18 or higher |
| npm | 9 or higher |
| Git | any recent version |

Check your versions:

```bash
node -v
npm -v
git --version
```

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Tekmadev/breakaid.git
cd breakaid
```

### 2. Install dependencies

```bash
npm install
```

### 3. Verify TypeScript compiles

```bash
npm run typecheck
```

Expected output: **silence** (no output = no errors).

---

## Project Structure

```
breakaid/
├── types/
│   └── index.ts        ← All shared TypeScript types (SCRUM-7)
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Shared Types (`/types/index.ts`)

All data models used across every module are defined here and exported as a barrel.

```ts
import type { TaskCode, Employee, TimeSlot, Gameplan } from './types';
```

| Type | Kind | Description |
|------|------|-------------|
| `TaskCode` | `type` | Union of `'D' \| 'W' \| 'B' \| 'B/D' \| 'FE' \| 'SEC' \| null` |
| `Employee` | `interface` | name, shiftStart, shiftEnd, canWalk, canSec |
| `TimeSlot` | `interface` | time, assignments `Record<string, TaskCode>` |
| `Gameplan` | `interface` | date, employees[], timeSlots[] |

> ⚠️ **Any change to a type must be discussed with both developers before merging.**

---

## Available Scripts

```bash
npm run typecheck        # Type-check the entire project (no emit)
npm run typecheck:watch  # Type-check in watch mode
```

---

## Git Workflow

1. Always branch from `main`
2. Branch naming: `feature/SCRUM-<id>-<short-description>`
3. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
4. Open a PR, get at least one review, then merge

```bash
git checkout main && git pull origin main
git checkout -b feature/SCRUM-X-your-feature
# ... do work ...
git add .
git commit -m "feat(scope): short description [SCRUM-X]"
git push origin feature/SCRUM-X-your-feature
```

---

## Ticket Status

| Ticket | Description | Status |
|--------|-------------|--------|
| SCRUM-7 | Shared TypeScript types `/types/index.ts` | ✅ Done |
| SCRUM-8 | TBD | ⏳ Pending |
| SCRUM-10 | TBD | ⏳ Pending |
| SCRUM-11 | TBD | ⏳ Pending |
| SCRUM-12 | TBD | ⏳ Pending |
| SCRUM-13 | TBD | ⏳ Pending |
