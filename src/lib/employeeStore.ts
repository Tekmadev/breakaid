/**
 * employeeStore.ts - The async data-access seam for persisted employee profiles.
 *
 * The Employee Management page and the gameplan builder talk ONLY to the
 * `employeeStore` singleton via the {@link EmployeeStore} interface, so the
 * backend is swappable without touching UI. The active backend is chosen at
 * module load:
 *   - Supabase (`supabaseEmployeeStore`) when NEXT_PUBLIC_SUPABASE_URL +
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY are set (see supabase/schema.sql).
 *   - localStorage (`localEmployeeStore`) otherwise - a zero-config fallback so
 *     the app still works before Supabase is configured.
 *
 * Methods are async (Promise-returning) so callers don't change shape across
 * backends. `upsert` takes a PARTIAL patch and is non-clobbering: only the keys
 * present in the patch are written, the rest are left untouched (Postgres
 * merge-duplicates on Supabase; read-merge on localStorage). A key present with
 * value `undefined` clears that (nullable) column.
 */

import type { EmployeeRecord } from "./types";
import { loadRecords, upsertRecord, removeRecord } from "./capabilities";
import { supabase, hasSupabaseEnv } from "./supabaseClient";

/** Backend-agnostic CRUD over persisted employee profiles, keyed by `name`. */
export interface EmployeeStore {
  /** All records, sorted by name (case-insensitive). */
  list(): Promise<EmployeeRecord[]>;
  /** Create or update one record (non-clobbering merge). Returns the saved record. */
  upsert(patch: Partial<EmployeeRecord> & { name: string }): Promise<EmployeeRecord>;
  /** Delete one record by name. */
  remove(name: string): Promise<void>;
}

const byName = (a: EmployeeRecord, b: EmployeeRecord) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

// ---------------------------------------------------------------------------
// localStorage backend (fallback), delegating to capabilities.ts.
// ---------------------------------------------------------------------------

export const localEmployeeStore: EmployeeStore = {
  async list() {
    return Object.values(loadRecords()).sort(byName);
  },
  async upsert(patch) {
    return upsertRecord(patch);
  },
  async remove(name) {
    removeRecord(name);
  },
};

// ---------------------------------------------------------------------------
// Supabase backend. Table columns (snake_case) <-> EmployeeRecord (camelCase).
// `updated_at` is owned by the DB (default now() + trigger), so it is never sent.
// ---------------------------------------------------------------------------

type EmployeeRow = {
  name: string;
  display_name: string | null;
  position: string | null;
  can_walk: boolean;
  can_sec: boolean;
  door_side: string | null;
  // Optional: absent from the result until the `door_excluded` migration runs,
  // so reads work on both the old and new schema (see rowToRecord's `?? false`).
  door_excluded?: boolean | null;
  last_shift: string | null;
  updated_at: string | null;
};

const toDoorSide = (v: string | null): EmployeeRecord["doorSide"] =>
  v === "in" || v === "out" ? v : "both";

const rowToRecord = (r: EmployeeRow): EmployeeRecord => ({
  name: r.name,
  displayName: r.display_name ?? undefined,
  position: r.position ?? undefined,
  canWalk: r.can_walk,
  canSec: r.can_sec,
  doorSide: toDoorSide(r.door_side),
  doorExcluded: r.door_excluded ?? false,
  lastShift: r.last_shift ?? undefined,
  updatedAt: r.updated_at ?? undefined,
});

/**
 * Build a partial DB payload from a patch - only keys actually present in the
 * patch are included, so an upsert updates exactly those columns (a key set to
 * `undefined` is sent as null to clear that nullable column).
 */
function patchToRow(patch: Partial<EmployeeRecord> & { name: string }): Record<string, unknown> {
  const row: Record<string, unknown> = { name: patch.name };
  if ("displayName" in patch) row.display_name = patch.displayName ?? null;
  if ("position" in patch) row.position = patch.position ?? null;
  if ("canWalk" in patch) row.can_walk = patch.canWalk;
  if ("canSec" in patch) row.can_sec = patch.canSec;
  if ("doorSide" in patch) row.door_side = patch.doorSide ?? "both";
  if ("doorExcluded" in patch) row.door_excluded = patch.doorExcluded ?? false;
  if ("lastShift" in patch) row.last_shift = patch.lastShift ?? null;
  return row;
}

export const supabaseEmployeeStore: EmployeeStore = {
  async list() {
    // select("*") (not an explicit column list) so a not-yet-migrated database
    // that lacks `door_excluded` still returns rows instead of erroring.
    const { data, error } = await supabase!
      .from("employees")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    return ((data as EmployeeRow[] | null) ?? []).map(rowToRecord);
  },
  async upsert(patch) {
    const { data, error } = await supabase!
      .from("employees")
      .upsert(patchToRow(patch), { onConflict: "name" })
      .select("*")
      .single();
    if (error) throw error;
    return rowToRecord(data as EmployeeRow);
  },
  async remove(name) {
    const { error } = await supabase!.from("employees").delete().eq("name", name);
    if (error) throw error;
  },
};

/** The active store. Supabase when configured, otherwise localStorage. */
export const employeeStore: EmployeeStore = hasSupabaseEnv
  ? supabaseEmployeeStore
  : localEmployeeStore;
