"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, CalendarDays, Clock } from "lucide-react";
import type { FinalizedGameplan, TaskCode } from "@/lib/types";
import { TIME_SLOTS } from "@/lib/generator";
import { gameplanStore } from "@/lib/gameplanStore";
import { supabase } from "@/lib/supabaseClient";
import SignOutButton from "@/components/SignOutButton";

/**
 * /view — the read-only day view for door staff (viewer accounts) on their
 * phones. Shows the finalized gameplan: who's on what RIGHT NOW (current
 * half-hour) and the full day table. No editing anywhere — and even if someone
 * tampered with the client, RLS only grants viewers SELECT on gameplans.
 *
 * If the signed-in account is linked to a roster name (app_metadata.
 * employee_name, set on the Users page), the page leads with that person's
 * current assignment and highlights their column.
 */

// Same fixed window as the printed form: 8:00 (idx 2) → 21:30 (idx 29).
const DISPLAY_START_IDX = 2;
const DISPLAY_END_IDX = 29;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Today's label in the schedule's format, e.g. "Mon 05/11/2026". */
function todayLabel(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${WEEKDAYS[now.getDay()]} ${mm}/${dd}/${now.getFullYear()}`;
}

/** Current 30-min slot index in TIME_SLOTS, or -1 outside the 7:00–24:00 grid. */
function currentSlotIdx(): number {
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const idx = Math.floor((min - 7 * 60) / 30);
  return idx >= 0 && idx < TIME_SLOTS.length ? idx : -1;
}

const CODE_LABELS: Record<string, string> = {
  IN: "Entrance",
  OUT: "Exit",
  D: "Door",
  W: "Walk",
  B: "Break",
  "B/D": "Break + Door",
  FE: "Front End",
  SEC: "Security",
  PUSH: "Carts",
  "FE HELP": "FE Help",
};

function codeColor(task: string): { bg: string; text: string } {
  switch (task) {
    case "W": return { bg: "var(--task-w-bg)", text: "var(--task-w-text)" };
    case "IN": return { bg: "var(--task-in-bg)", text: "var(--task-in-text)" };
    case "OUT": return { bg: "var(--task-out-bg)", text: "var(--task-out-text)" };
    case "D": case "B/D": return { bg: "var(--task-d-bg)", text: "var(--task-d-text)" };
    case "B": return { bg: "var(--task-b-bg)", text: "var(--task-b-text)" };
    case "FE": return { bg: "var(--task-fe-bg)", text: "var(--task-fe-text)" };
    case "SEC": return { bg: "var(--task-sec-bg)", text: "var(--task-sec-text)" };
    case "PUSH": return { bg: "var(--task-push-bg)", text: "var(--task-push-text)" };
    case "FE HELP": return { bg: "var(--alert-danger)", text: "#ffffff" };
    default: return { bg: "var(--task-none-bg)", text: "var(--text-primary)" };
  }
}

export default function ViewPage() {
  const [plans, setPlans] = useState<FinalizedGameplan[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [myName, setMyName] = useState<string | null>(null);
  const [isManagerAcct, setIsManagerAcct] = useState(false);
  // Ticks every 30s so the "right now" section tracks the clock.
  const [nowIdx, setNowIdx] = useState<number>(() => currentSlotIdx());

  const load = useCallback(async () => {
    try {
      const all = await gameplanStore.list();
      setPlans(all);
      setSelectedDate((prev) => {
        if (prev && all.some((p) => p.date === prev)) return prev;
        const today = todayLabel();
        if (all.some((p) => p.date === today)) return today;
        return all[0]?.date ?? null;
      });
    } catch {
      // keep whatever we had; transient network issues shouldn't blank the page
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: load() is async — every setState inside it runs after an
    // await, never synchronously in the effect body (rule can't see through it).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    supabase?.auth.getUser().then(({ data }) => {
      const meta = data.user?.app_metadata as
        | { role?: string; employee_name?: string | null }
        | undefined;
      setMyName(meta?.employee_name ?? null);
      setIsManagerAcct(meta?.role !== "viewer");
    });

    const tick = setInterval(() => setNowIdx(currentSlotIdx()), 30_000);
    const refetch = setInterval(load, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNowIdx(currentSlotIdx());
        load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(refetch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const plan = useMemo(
    () => plans.find((p) => p.date === selectedDate) ?? null,
    [plans, selectedDate]
  );
  const isToday = selectedDate === todayLabel();
  const nowTime = nowIdx >= 0 ? TIME_SLOTS[nowIdx] : null;

  // My current assignment (only meaningful for today's plan).
  const me = plan?.roster.find((e) => e.name === myName) ?? null;
  const myCode: TaskCode | "" =
    me && isToday && nowTime ? ((plan?.plan[me.name]?.[nowTime] ?? "") as TaskCode) : "";

  // When my current code ends (scan forward for the next different code).
  const myUntil = useMemo(() => {
    if (!me || !plan || !isToday || nowIdx < 0) return null;
    for (let i = nowIdx + 1; i < TIME_SLOTS.length; i++) {
      if ((plan.plan[me.name]?.[TIME_SLOTS[i]] ?? "") !== myCode) return TIME_SLOTS[i];
    }
    return null;
  }, [me, plan, isToday, nowIdx, myCode]);

  const rowIdxs = useMemo(() => {
    const idxs: number[] = [];
    for (let i = DISPLAY_START_IDX; i <= DISPLAY_END_IDX; i++) idxs.push(i);
    return idxs;
  }, []);

  return (
    <div className="animate-fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        className="header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem 5%",
          borderBottom: "3px solid var(--accent-secondary)",
        }}
      >
        <span style={{ color: "var(--accent-secondary)", fontWeight: 700, fontSize: "1.05rem" }}>
          BreakAid · Day View
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isManagerAcct && (
            <Link
              href="/"
              style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textDecoration: "none", padding: "0.4rem 0.6rem" }}
            >
              Builder
            </Link>
          )}
          <SignOutButton />
        </div>
      </header>

      <main style={{ flex: 1, padding: "1rem", maxWidth: "1100px", margin: "0 auto", width: "100%" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)", padding: "2rem 0" }}>
            <RefreshCw className="animate-spin" size={18} /> Loading gameplan…
          </div>
        ) : plans.length === 0 ? (
          <div className="glass-panel" style={{ padding: "2rem", textAlign: "center", color: "var(--text-secondary)" }}>
            <CalendarDays size={32} style={{ marginBottom: "0.5rem" }} />
            <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>No finalized gameplan yet</p>
            <p style={{ fontSize: "0.875rem" }}>Check back once a manager finalizes today&apos;s plan.</p>
          </div>
        ) : (
          <>
            {/* Day picker */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
              <CalendarDays size={18} color="var(--accent-secondary)" />
              <select
                value={selectedDate ?? ""}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-color)",
                  backgroundColor: "var(--bg-secondary)",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                  fontSize: "0.9rem",
                }}
              >
                {plans.map((p) => (
                  <option key={p.date} value={p.date}>
                    {p.date}
                    {p.date === todayLabel() ? " (today)" : ""}
                  </option>
                ))}
              </select>
              {isToday && nowTime && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <Clock size={14} /> current slot: {nowTime}
                </span>
              )}
            </div>

            {plan && (
              <>
                {/* My assignment right now */}
                {me && isToday && (
                  <div
                    className="glass-panel"
                    style={{
                      padding: "1.25rem",
                      marginBottom: "1rem",
                      borderLeft: `6px solid ${codeColor(myCode).text}`,
                    }}
                  >
                    <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.25rem" }}>
                      {me.name} · shift {me.shift}
                    </div>
                    {myCode ? (
                      <div style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", flexWrap: "wrap" }}>
                        <span
                          style={{
                            fontSize: "1.6rem",
                            fontWeight: 800,
                            padding: "0.1rem 0.6rem",
                            borderRadius: "var(--radius-sm)",
                            backgroundColor: codeColor(myCode).bg,
                            color: codeColor(myCode).text,
                          }}
                        >
                          {myCode}
                        </span>
                        <span style={{ fontSize: "1.1rem", fontWeight: 600 }}>
                          {CODE_LABELS[myCode] ?? myCode} right now
                        </span>
                        {myUntil && (
                          <span style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>until {myUntil}</span>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: "1rem", fontWeight: 600 }}>
                        Not on the door schedule right now.
                      </div>
                    )}
                  </div>
                )}

                {/* Everyone right now */}
                {isToday && nowTime && (
                  <div className="glass-panel" style={{ padding: "1rem 1.25rem", marginBottom: "1rem" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.6rem" }}>
                      Door team at {nowTime}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                      {plan.roster.map((e) => {
                        const code = (plan.plan[e.name]?.[nowTime] ?? "") as string;
                        if (!code) return null;
                        const c = codeColor(code);
                        return (
                          <span
                            key={e.name}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "0.4rem",
                              padding: "0.35rem 0.6rem",
                              borderRadius: "999px",
                              border: e.name === myName ? "2px solid var(--accent-secondary)" : "1px solid var(--border-color)",
                              backgroundColor: "var(--bg-secondary)",
                              fontSize: "0.8rem",
                            }}
                          >
                            <strong>{e.name}</strong>
                            <span
                              style={{
                                padding: "0.05rem 0.4rem",
                                borderRadius: "var(--radius-sm)",
                                backgroundColor: c.bg,
                                color: c.text,
                                fontWeight: 700,
                                fontSize: "0.75rem",
                              }}
                            >
                              {code}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Full-day table (read-only) */}
                <div
                  style={{
                    overflowX: "auto",
                    backgroundColor: "var(--bg-secondary)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-color)",
                  }}
                >
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "center", fontSize: "0.75rem" }}>
                    <thead>
                      <tr style={{ backgroundColor: "var(--bg-tertiary)" }}>
                        <th style={{ padding: "0.5rem", position: "sticky", left: 0, backgroundColor: "var(--bg-tertiary)", zIndex: 2, textAlign: "left" }}>
                          Time
                        </th>
                        {plan.roster.map((e) => (
                          <th
                            key={e.name}
                            style={{
                              padding: "0.5rem 0.4rem",
                              minWidth: "56px",
                              backgroundColor: e.name === myName ? "var(--task-w-bg)" : "var(--bg-tertiary)",
                            }}
                          >
                            <div style={{ fontWeight: 700 }}>{e.name}</div>
                            <div style={{ fontWeight: 400, color: "var(--text-secondary)", fontSize: "0.65rem" }}>{e.shift}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rowIdxs.map((i) => {
                        const time = TIME_SLOTS[i];
                        const isNowRow = isToday && i === nowIdx;
                        return (
                          <tr
                            key={time}
                            style={{
                              borderBottom: "1px solid var(--border-color)",
                              outline: isNowRow ? "2px solid var(--accent-secondary)" : undefined,
                              outlineOffset: "-2px",
                            }}
                          >
                            <td
                              style={{
                                padding: "0.4rem 0.5rem",
                                textAlign: "left",
                                fontWeight: isNowRow ? 800 : 500,
                                position: "sticky",
                                left: 0,
                                backgroundColor: "var(--bg-secondary)",
                                zIndex: 1,
                              }}
                            >
                              {time}
                            </td>
                            {plan.roster.map((e) => {
                              const active = i >= e.shiftStartIdx && i < e.shiftEndIdx;
                              const code = (plan.plan[e.name]?.[time] ?? "") as string;
                              const c = codeColor(code);
                              return (
                                <td
                                  key={`${e.name}-${time}`}
                                  style={{
                                    padding: "0.35rem 0.2rem",
                                    backgroundColor: active ? c.bg : "var(--bg-tertiary)",
                                    color: active ? c.text : "var(--text-muted)",
                                    fontWeight: code ? 700 : 400,
                                    opacity: active ? 1 : 0.4,
                                  }}
                                >
                                  {active ? code : ""}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p style={{ color: "var(--text-muted)", fontSize: "0.72rem", marginTop: "0.75rem" }}>
                  Read-only view · finalized{" "}
                  {plan.finalizedAt ? new Date(plan.finalizedAt).toLocaleString() : "—"}
                  {plan.updatedByEmail ? ` by ${plan.updatedByEmail}` : ""} · updates automatically
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
