/**
 * capabilities.ts - Low-level, synchronous localStorage CRUD for persisted
 * employee profiles ({@link EmployeeRecord}), keyed by employee name.
 *
 * This is the localStorage backing for `localEmployeeStore` (the zero-config
 * fallback in `employeeStore.ts`, used when Supabase isn't configured). All app
 * code goes through the async `employeeStore` seam, not these functions directly.
 *
 * Storage shape: `Record<name, EmployeeRecord>` under STORAGE_KEY. It is
 * backward-compatible with the original `{ canWalk, canSec }`-only shape -  * older entries are normalized on read (name filled from the key).
 */

import type { EmployeeRecord } from "./types";

const STORAGE_KEY = "breakaid-capabilities";

/** Coerce a raw stored value (possibly the legacy shape) into an EmployeeRecord. */
function normalize(name: string, raw: unknown): EmployeeRecord {
  const v = (raw ?? {}) as Partial<EmployeeRecord>;
  return {
    name, // always trust the map key as the canonical name
    displayName: v.displayName,
    position: v.position,
    canWalk: v.canWalk ?? true,
    canSec: v.canSec ?? false,
    canFE: v.canFE ?? true,
    doorSide: v.doorSide ?? "both",
    doorExcluded: v.doorExcluded ?? false,
    lastShift: v.lastShift,
    updatedAt: v.updatedAt,
  };
}

/** Read the full name → EmployeeRecord map (SSR-safe; {} on miss/parse error). */
export function loadRecords(): Record<string, EmployeeRecord> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<
      string,
      unknown
    >;
    const out: Record<string, EmployeeRecord> = {};
    for (const name of Object.keys(parsed)) out[name] = normalize(name, parsed[name]);
    return out;
  } catch {
    return {};
  }
}

/** Persist the full map. No-op during SSR; never throws on storage failure. */
function writeRecords(all: Record<string, EmployeeRecord>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full/disabled - never crash the scheduling UI over persistence.
  }
}

/**
 * Insert or update one record, merging the patch onto any existing record for
 * that name (so a partial patch is non-clobbering), and stamping `updatedAt`.
 * A key present with value `undefined` clears that field. Returns the saved record.
 */
export function upsertRecord(patch: Partial<EmployeeRecord> & { name: string }): EmployeeRecord {
  const all = loadRecords();
  const merged = normalize(patch.name, { ...all[patch.name], ...patch });
  merged.updatedAt = new Date().toISOString();
  all[patch.name] = merged;
  writeRecords(all);
  return merged;
}

/** Delete one record by name. No-op if absent. */
export function removeRecord(name: string): void {
  const all = loadRecords();
  if (!(name in all)) return;
  delete all[name];
  writeRecords(all);
}
