/**
 * gameplanStore.ts - Async data-access seam for FINALIZED day gameplans.
 *
 * Same pattern as employeeStore.ts: callers use the `gameplanStore` singleton,
 * which is Supabase-backed when configured (table `public.gameplans`, see
 * supabase/schema.sql) and localStorage otherwise. Keyed by `date` (the
 * day-picker's date label). `save` upserts, so re-finalizing a day overwrites it.
 */

import type { FinalizedGameplan } from "./types";
import { supabase, hasSupabaseEnv } from "./supabaseClient";

export interface GameplanStore {
  /** All finalized plans, most-recently-finalized first. */
  list(): Promise<FinalizedGameplan[]>;
  /** One finalized plan by date label, or null if none. */
  get(date: string): Promise<FinalizedGameplan | null>;
  /** Insert or overwrite the finalized plan for its date. Returns the saved record. */
  save(plan: FinalizedGameplan): Promise<FinalizedGameplan>;
}

// ---------------------------------------------------------------------------
// localStorage backend (fallback)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "breakaid-gameplans";

function loadLocal(): Record<string, FinalizedGameplan> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<
      string,
      FinalizedGameplan
    >;
  } catch {
    return {};
  }
}

function writeLocal(all: Record<string, FinalizedGameplan>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full/disabled - never crash the UI over persistence.
  }
}

export const localGameplanStore: GameplanStore = {
  async list() {
    return Object.values(loadLocal()).sort((a, b) =>
      (b.finalizedAt ?? "").localeCompare(a.finalizedAt ?? "")
    );
  },
  async get(date) {
    return loadLocal()[date] ?? null;
  },
  async save(plan) {
    const all = loadLocal();
    const saved = { ...plan, finalizedAt: new Date().toISOString() };
    all[plan.date] = saved;
    writeLocal(all);
    return saved;
  },
};

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

type GameplanRow = {
  plan_date: string;
  is_weekend: boolean;
  roster: FinalizedGameplan["roster"];
  plan: FinalizedGameplan["plan"];
  finalized_at: string | null;
  created_by_email: string | null;
  updated_by_email: string | null;
};

// Audit columns (created_by/updated_by) are DB-owned: a trigger stamps them
// from the caller's JWT on every insert/update - the client never sends them.
const COLUMNS =
  "plan_date, is_weekend, roster, plan, finalized_at, created_by_email, updated_by_email";

const rowToPlan = (r: GameplanRow): FinalizedGameplan => ({
  date: r.plan_date,
  isWeekend: r.is_weekend,
  roster: r.roster ?? [],
  plan: r.plan ?? {},
  finalizedAt: r.finalized_at ?? undefined,
  createdByEmail: r.created_by_email ?? undefined,
  updatedByEmail: r.updated_by_email ?? undefined,
});

export const supabaseGameplanStore: GameplanStore = {
  async list() {
    const { data, error } = await supabase!
      .from("gameplans")
      .select(COLUMNS)
      .order("finalized_at", { ascending: false });
    if (error) throw error;
    return ((data as GameplanRow[] | null) ?? []).map(rowToPlan);
  },
  async get(date) {
    const { data, error } = await supabase!
      .from("gameplans")
      .select(COLUMNS)
      .eq("plan_date", date)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToPlan(data as GameplanRow) : null;
  },
  async save(plan) {
    const row = {
      plan_date: plan.date,
      is_weekend: plan.isWeekend,
      roster: plan.roster,
      plan: plan.plan,
      finalized_at: new Date().toISOString(),
    };
    const { data, error } = await supabase!
      .from("gameplans")
      .upsert(row, { onConflict: "plan_date" })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return rowToPlan(data as GameplanRow);
  },
};

/** Active store: Supabase when configured, otherwise localStorage. */
export const gameplanStore: GameplanStore = hasSupabaseEnv
  ? supabaseGameplanStore
  : localGameplanStore;
