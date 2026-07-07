"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  UserPlus,
  Trash2,
  KeyRound,
  RefreshCw,
  AlertCircle,
  Info,
} from "lucide-react";
import type { EmployeeRecord } from "@/lib/types";
import { employeeStore } from "@/lib/employeeStore";
import SignOutButton from "@/components/SignOutButton";

/**
 * Users — manager-only account administration (backed by /api/admin/users).
 *
 * Managers: full access to the whole app. Viewers: door staff accounts that
 * can ONLY see the read-only /view page on their phone; linking a viewer to a
 * roster name makes /view lead with "You are IN/OUT/… right now".
 */

type Role = "manager" | "viewer";

type UserSummary = {
  id: string;
  email: string;
  role: Role;
  developer: boolean;
  employeeName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function UsersPage() {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [callerId, setCallerId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create form.
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("viewer");
  const [newEmployee, setNewEmployee] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed to load users (${res.status}).`);
      setUsers(body.users ?? []);
      setCallerId(body.callerId ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount: load() is async — every setState inside it runs after an
    // await, never synchronously in the effect body (rule can't see through it).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    employeeStore.list().then(setEmployees).catch(() => {});
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          role: newRole,
          employeeName: newRole === "viewer" ? newEmployee || undefined : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to create the account.");
      setUsers((prev) =>
        [...prev, body.user as UserSummary].sort((a, b) => a.email.localeCompare(b.email))
      );
      setNewEmail("");
      setNewPassword("");
      setNewEmployee("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create the account.");
    } finally {
      setCreating(false);
    }
  };

  const patchUser = async (
    u: UserSummary,
    changes: { password?: string; role?: Role; employeeName?: string | null }
  ) => {
    setBusyId(u.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: u.id,
          role: changes.role ?? u.role,
          employeeName: "employeeName" in changes ? changes.employeeName : u.employeeName,
          password: changes.password,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Update failed.");
      setUsers((prev) => prev.map((x) => (x.id === u.id ? (body.user as UserSummary) : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = (u: UserSummary) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 characters):`);
    if (!pw) return;
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    patchUser(u, { password: pw });
  };

  const handleDelete = async (u: UserSummary) => {
    if (!window.confirm(`Delete the account ${u.email}? They will no longer be able to sign in.`)) return;
    setBusyId(u.id);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Delete failed.");
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="animate-fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        className="header"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "3px solid var(--accent-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/5/59/Costco_Wholesale_logo_2010-10-26.svg"
            alt="Costco Wholesale"
            style={{ height: "32px" }}
          />
          <h1
            style={{
              color: "var(--accent-secondary)",
              borderLeft: "2px solid var(--border-color)",
              paddingLeft: "1rem",
              marginLeft: "0.5rem",
            }}
          >
            User Accounts
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link
            href="/"
            className="btn-primary"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              textDecoration: "none",
              backgroundColor: "var(--bg-tertiary)",
              color: "var(--text-primary)",
            }}
          >
            <ArrowLeft size={18} />
            Back to Gameplan
          </Link>
          <SignOutButton />
        </div>
      </header>

      <main className="container" style={{ flex: 1, maxWidth: "1100px" }}>
        <div className="glass-panel" style={{ padding: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <ShieldCheck size={20} color="var(--accent-secondary)" />
            <h2>Accounts &amp; Roles</h2>
          </div>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1.25rem", fontSize: "0.9rem" }}>
            <strong>Managers</strong> can build, edit and finalize gameplans.{" "}
            <strong>Viewers</strong> are door-staff accounts: on their phone they only see the
            read-only day view — who&apos;s at the entrance/exit right now and the full table. Link a
            viewer to a roster name and their view highlights their own assignment.
          </p>

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
              Every account change here is server-verified: only managers can call this page&apos;s
              API, roles are stored server-side (users can&apos;t change their own), and you can&apos;t
              demote or delete your own account.
            </span>
          </div>

          {/* Create account */}
          <form
            onSubmit={handleCreate}
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.75rem",
              alignItems: "flex-end",
              marginBottom: "0.75rem",
            }}
          >
            <label style={fieldStyle}>
              <span style={labelStyle}>Email</span>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="person@example.com"
                style={inputStyle}
              />
            </label>
            <label style={fieldStyle}>
              <span style={labelStyle}>Password (min 8)</span>
              <input
                type="text"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="temporary password"
                style={inputStyle}
              />
            </label>
            <label style={{ ...fieldStyle, flex: "0 1 150px" }}>
              <span style={labelStyle}>Role</span>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} style={inputStyle}>
                <option value="viewer">Viewer</option>
                <option value="manager">Manager</option>
              </select>
            </label>
            {newRole === "viewer" && (
              <label style={{ ...fieldStyle, flex: "0 1 200px" }}>
                <span style={labelStyle}>Linked employee</span>
                <select value={newEmployee} onChange={(e) => setNewEmployee(e.target.value)} style={inputStyle}>
                  <option value="">— not linked —</option>
                  {employees.map((emp) => (
                    <option key={emp.name} value={emp.name}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={creating}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
            >
              {creating ? <RefreshCw className="animate-spin" size={18} /> : <UserPlus size={18} />}
              {creating ? "Creating…" : "Create account"}
            </button>
          </form>
          {formError && (
            <p style={{ color: "var(--alert-text)", fontSize: "0.8rem", marginBottom: "1rem" }}>{formError}</p>
          )}

          {error && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                color: "var(--alert-text)",
                backgroundColor: "var(--alert-bg)",
                padding: "0.6rem 0.75rem",
                borderRadius: "var(--radius-md)",
                fontSize: "0.825rem",
                marginBottom: "1rem",
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)", padding: "2rem 0" }}>
              <RefreshCw className="animate-spin" size={18} /> Loading accounts…
            </div>
          ) : (
            <div style={{ overflowX: "auto", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", marginTop: "0.75rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ backgroundColor: "var(--bg-tertiary)", borderBottom: "2px solid var(--border-color)" }}>
                    <th style={thStyle}>Email</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Linked employee</th>
                    <th style={thStyle}>Created</th>
                    <th style={thStyle}>Last sign-in</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = u.id === callerId;
                    const busy = busyId === u.id;
                    return (
                      <tr key={u.id} style={{ borderBottom: "1px solid var(--border-color)", opacity: busy ? 0.6 : 1 }}>
                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>
                          {u.email}
                          {isSelf && (
                            <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--text-muted)" }}>(you)</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {u.developer ? (
                            <span
                              title="Permanent developer account — cannot be demoted or deleted"
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.3rem",
                                padding: "0.25rem 0.6rem",
                                borderRadius: "999px",
                                backgroundColor: "var(--task-sec-bg)",
                                color: "var(--task-sec-text)",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                              }}
                            >
                              <ShieldCheck size={13} />
                              Developer
                            </span>
                          ) : (
                            <select
                              value={u.role}
                              disabled={busy || isSelf}
                              onChange={(e) => patchUser(u, { role: e.target.value as Role })}
                              title={isSelf ? "You can't change your own role" : "Change role"}
                              style={{ ...inputStyle, padding: "0.3rem 0.4rem", fontSize: "0.8rem", width: "auto" }}
                            >
                              <option value="manager">Manager</option>
                              <option value="viewer">Viewer</option>
                            </select>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {u.role === "viewer" ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                              <Smartphone size={14} color="var(--text-muted)" />
                              <select
                                value={u.employeeName ?? ""}
                                disabled={busy}
                                onChange={(e) => patchUser(u, { employeeName: e.target.value || null })}
                                style={{ ...inputStyle, padding: "0.3rem 0.4rem", fontSize: "0.8rem", width: "auto" }}
                              >
                                <option value="">— not linked —</option>
                                {employees.map((emp) => (
                                  <option key={emp.name} value={emp.name}>
                                    {emp.name}
                                  </option>
                                ))}
                              </select>
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>—</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                          {fmtDate(u.createdAt)}
                        </td>
                        <td style={{ ...tdStyle, color: "var(--text-muted)", fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                          {fmtDate(u.lastSignInAt)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => handleResetPassword(u)}
                            disabled={busy || (u.developer && !isSelf)}
                            title={
                              u.developer && !isSelf
                                ? "Only the developer can change this account"
                                : `Set a new password for ${u.email}`
                            }
                            style={{
                              ...iconBtnStyle,
                              color: u.developer && !isSelf ? "var(--text-muted)" : "var(--text-secondary)",
                            }}
                          >
                            <KeyRound size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(u)}
                            disabled={busy || isSelf || u.developer}
                            title={
                              u.developer
                                ? "The developer account cannot be deleted"
                                : isSelf
                                  ? "You can't delete your own account"
                                  : `Delete ${u.email}`
                            }
                            style={{
                              ...iconBtnStyle,
                              color: isSelf || u.developer ? "var(--text-muted)" : "var(--alert-danger)",
                            }}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  flex: "1 1 200px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
};

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

const iconBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--text-secondary)",
  display: "inline-flex",
  padding: "0.3rem",
};
