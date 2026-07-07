"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users,
  ArrowLeft,
  UserPlus,
  Trash2,
  Search,
  RefreshCw,
  Info,
} from "lucide-react";
import type { DoorSide, EmployeeRecord } from "@/lib/types";
import { employeeStore } from "@/lib/employeeStore";
import { hasSupabaseEnv } from "@/lib/supabaseClient";
import AppHeader from "@/components/AppHeader";

/** Format an ISO timestamp as a short, locale date - or " - " when absent. */
function formatUpdated(iso?: string): string {
  if (!iso) return " - ";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return " - ";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function EmployeesPage() {
  const [records, setRecords] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Add-employee form.
  const [newName, setNewName] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Initial load from the store (localStorage today, Supabase later).
  useEffect(() => {
    let cancelled = false;
    employeeStore
      .list()
      .then((rows) => {
        if (!cancelled) setRecords(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the list sorted by name (case-insensitive) after any local mutation.
  const resort = (rows: EmployeeRecord[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const upsertLocal = useCallback((saved: EmployeeRecord) => {
    setRecords((prev) => {
      const without = prev.filter((r) => r.name !== saved.name);
      return resort([...without, saved]);
    });
  }, []);

  const handleToggle = useCallback(
    async (rec: EmployeeRecord, field: "canWalk" | "canSec") => {
      const saved = await employeeStore.upsert({ name: rec.name, [field]: !rec[field] });
      upsertLocal(saved);
    },
    [upsertLocal]
  );

  const handleDoorSide = useCallback(
    async (rec: EmployeeRecord, side: DoorSide) => {
      const saved = await employeeStore.upsert({ name: rec.name, doorSide: side });
      upsertLocal(saved);
    },
    [upsertLocal]
  );

  // Position: edit locally on each keystroke, commit to the store on blur.
  const handlePositionChange = (name: string, value: string) => {
    setRecords((prev) => prev.map((r) => (r.name === name ? { ...r, position: value } : r)));
  };
  const commitPosition = useCallback(
    async (rec: EmployeeRecord) => {
      const saved = await employeeStore.upsert({
        name: rec.name,
        position: rec.position?.trim() || undefined,
      });
      upsertLocal(saved);
    },
    [upsertLocal]
  );

  // Display name: edit locally on each keystroke, commit to the store on blur.
  // Blank clears it, so the gameplan falls back to the roster name.
  const handleDisplayNameChange = (name: string, value: string) => {
    setRecords((prev) => prev.map((r) => (r.name === name ? { ...r, displayName: value } : r)));
  };
  const commitDisplayName = useCallback(
    async (rec: EmployeeRecord) => {
      const saved = await employeeStore.upsert({
        name: rec.name,
        displayName: rec.displayName?.trim() || undefined,
      });
      upsertLocal(saved);
    },
    [upsertLocal]
  );

  const handleRemove = useCallback(async (name: string) => {
    if (!window.confirm(`Remove ${name}? Their saved capabilities will be deleted.`)) return;
    await employeeStore.remove(name);
    setRecords((prev) => prev.filter((r) => r.name !== name));
  }, []);

  const handleAdd = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = newName.trim();
      if (!name) {
        setAddError("Enter a name.");
        return;
      }
      if (records.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
        setAddError(`${name} already exists.`);
        return;
      }
      const saved = await employeeStore.upsert({
        name,
        position: newPosition.trim() || undefined,
        canWalk: true,
        canSec: false,
        doorSide: "both",
      });
      upsertLocal(saved);
      setNewName("");
      setNewPosition("");
      setAddError(null);
    },
    [newName, newPosition, records, upsertLocal]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.displayName ?? "").toLowerCase().includes(q) ||
        (r.position ?? "").toLowerCase().includes(q)
    );
  }, [records, query]);

  return (
    <div className="animate-fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader
        title="Employee Management"
        actions={[{ kind: "link", label: "Back to Gameplan", href: "/", icon: <ArrowLeft size={18} /> }]}
      />

      <main className="container" style={{ flex: 1, maxWidth: "1100px" }}>
        <div className="glass-panel" style={{ padding: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <Users size={20} color="var(--accent-secondary)" />
            <h2>Employees &amp; Capabilities</h2>
          </div>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.25rem", fontSize: "0.9rem" }}>
            Set each person&apos;s <strong>display name</strong> (the friendlier label shown on the
            gameplan; leave it blank to use their schedule name), who can <strong>Walk (W)</strong>,
            who can do <strong>Security (SEC)</strong>, and any <strong>door-side restriction</strong>{" "}
            (e.g. entrance-only for medical reasons) once here. The generator reads these every time you
            build a gameplan, so you never re-set them per upload. People appear here automatically
            after you open a day in the builder, or add them manually below.
          </p>

          {/* Storage notice */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--task-w-bg)",
              color: "var(--task-w-text)",
              fontSize: "0.8rem",
              marginBottom: "1.5rem",
            }}
          >
            <Info size={16} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
            <span>
              {hasSupabaseEnv
                ? "Synced to the shared database - changes here apply automatically to every future gameplan, on every device."
                : "Saved in this browser only (Supabase is not configured). Set the Supabase env vars to sync across devices."}
            </span>
          </div>

          {/* Add employee */}
          <form
            onSubmit={handleAdd}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "flex-end",
              marginBottom: "1.5rem",
            }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: "1 1 200px" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Name</span>
              <input
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  if (addError) setAddError(null);
                }}
                placeholder="e.g. Jen L"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: "1 1 200px" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Position (optional)
              </span>
              <input
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                placeholder="e.g. 086-Security"
                style={inputStyle}
              />
            </label>
            <button type="submit" className="btn-primary" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <UserPlus size={18} />
              Add
            </button>
          </form>
          {addError && (
            <p style={{ color: "var(--alert-text)", fontSize: "0.8rem", marginTop: "-1rem", marginBottom: "1rem" }}>
              {addError}
            </p>
          )}

          {/* Search */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              padding: "0.5rem 0.75rem",
              marginBottom: "1rem",
              maxWidth: "320px",
              backgroundColor: "var(--bg-primary)",
            }}
          >
            <Search size={16} color="var(--text-muted)" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or position…"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--text-primary)",
                fontFamily: "inherit",
                fontSize: "0.875rem",
                width: "100%",
              }}
            />
          </div>

          {/* Table / states */}
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)", padding: "2rem 0" }}>
              <RefreshCw className="animate-spin" size={18} /> Loading employees…
            </div>
          ) : records.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <div style={{ overflowX: "auto", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ backgroundColor: "var(--bg-tertiary)", borderBottom: "2px solid var(--border-color)" }}>
                      <th style={thStyle}>Name</th>
                      <th style={thStyle}>Display name</th>
                      <th style={thStyle}>Position</th>
                      <th style={thStyle}>Last shift</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Can Walk (W)</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Can Sec (SEC)</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Door side</th>
                      <th style={thStyle}>Updated</th>
                      <th style={{ ...thStyle, textAlign: "center" }}>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((rec) => (
                      <tr key={rec.name} style={{ borderBottom: "1px solid var(--border-color)" }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{rec.name}</td>
                        <td style={tdStyle}>
                          <input
                            value={rec.displayName ?? ""}
                            onChange={(e) => handleDisplayNameChange(rec.name, e.target.value)}
                            onBlur={() => commitDisplayName(rec)}
                            placeholder={rec.name}
                            aria-label={`Display name for ${rec.name}`}
                            style={{ ...inputStyle, padding: "0.35rem 0.5rem", fontSize: "0.8rem", maxWidth: "160px" }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            value={rec.position ?? ""}
                            onChange={(e) => handlePositionChange(rec.name, e.target.value)}
                            onBlur={() => commitPosition(rec)}
                            placeholder=" - "
                            aria-label={`Position for ${rec.name}`}
                            style={{ ...inputStyle, padding: "0.35rem 0.5rem", fontSize: "0.8rem", maxWidth: "160px" }}
                          />
                        </td>
                        <td style={{ ...tdStyle, color: "var(--text-secondary)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                          {rec.lastShift ?? " - "}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={rec.canWalk}
                            onChange={() => handleToggle(rec, "canWalk")}
                            aria-label={`${rec.name} can walk`}
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={rec.canSec}
                            onChange={() => handleToggle(rec, "canSec")}
                            aria-label={`${rec.name} can do security`}
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <select
                            value={rec.doorSide}
                            onChange={(e) => handleDoorSide(rec, e.target.value as DoorSide)}
                            aria-label={`Door side for ${rec.name}`}
                            style={{ ...inputStyle, padding: "0.3rem 0.4rem", fontSize: "0.8rem", width: "auto" }}
                          >
                            <option value="both">Both</option>
                            <option value="in">Entrance only</option>
                            <option value="out">Exit only</option>
                          </select>
                        </td>
                        <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                          {formatUpdated(rec.updatedAt)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <button
                            onClick={() => handleRemove(rec.name)}
                            title={`Remove ${rec.name}`}
                            aria-label={`Remove ${rec.name}`}
                            style={{
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "var(--alert-danger)",
                              display: "inline-flex",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", padding: "1rem 0" }}>
                  No employees match “{query}”.
                </p>
              )}
              <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", marginTop: "1rem" }}>
                {records.length} {records.length === 1 ? "employee" : "employees"} saved.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "3rem 1rem",
        color: "var(--text-secondary)",
        border: "1px dashed var(--border-color)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <Users size={36} color="var(--text-muted)" style={{ marginBottom: "0.75rem" }} />
      <p style={{ marginBottom: "0.25rem", fontWeight: 600, color: "var(--text-primary)" }}>No employees yet</p>
      <p style={{ fontSize: "0.875rem" }}>
        Open a day in the{" "}
        <Link href="/" style={{ color: "var(--accent-secondary)" }}>
          gameplan builder
        </Link>{" "}
        to seed the roster from a schedule, or add someone with the form above.
      </p>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-color)",
  backgroundColor: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  fontSize: "0.875rem",
  width: "100%",
};

const thStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  fontSize: "0.78rem",
  fontWeight: 700,
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
};
