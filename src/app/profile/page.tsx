"use client";

import React, { useEffect, useState } from "react";
import { UserCog, Mail, ShieldCheck, KeyRound, IdCard, RefreshCw, CheckCircle2, AlertCircle, Save } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import PasswordInput from "@/components/PasswordInput";
import AppHeader from "@/components/AppHeader";
import AppFooter from "@/components/AppFooter";

/**
 * /profile - a self-service account page for every signed-in user.
 *
 * Everyone can change their own password. Accounts linked to a roster name
 * (door staff / viewers, via app_metadata.employee_name) can also set their own
 * display name - the friendlier label shown on the gameplan. That write goes
 * through the `set_my_display_name` RPC (SECURITY DEFINER), so a viewer can edit
 * ONLY their own name and nothing else on the employees table.
 */

const MIN_PASSWORD = 8;

export default function ProfilePage() {
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<"manager" | "viewer">("manager");
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  // Without a Supabase client there is nothing to load, so start "loaded".
  const [loaded, setLoaded] = useState(() => !supabase);

  // Display name (only for accounts linked to a roster name).
  const [displayName, setDisplayName] = useState("");
  const [displaySaving, setDisplaySaving] = useState(false);
  const [displayMsg, setDisplayMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Change password.
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    client.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail(u?.email ?? null);
      const meta = u?.app_metadata as { role?: string; employee_name?: string | null } | undefined;
      setRole(meta?.role === "viewer" ? "viewer" : "manager");
      const en = meta?.employee_name ?? null;
      setEmployeeName(en);
      setLoaded(true);
      if (en) {
        client.rpc("get_my_display_name").then(({ data: dn }) => {
          setDisplayName(((dn as string | null) ?? "") || "");
        });
      }
    });
  }, []);

  const saveDisplayName = async () => {
    if (!supabase) return;
    setDisplaySaving(true);
    setDisplayMsg(null);
    const { error } = await supabase.rpc("set_my_display_name", { new_display_name: displayName });
    setDisplaySaving(false);
    setDisplayMsg(
      error
        ? { ok: false, text: `Could not save: ${error.message}` }
        : { ok: true, text: "Saved. Your name will show on the gameplan." }
    );
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    if (pw.length < MIN_PASSWORD) {
      setPwMsg({ ok: false, text: `Use at least ${MIN_PASSWORD} characters.` });
      return;
    }
    if (pw !== pw2) {
      setPwMsg({ ok: false, text: "The two passwords do not match." });
      return;
    }
    setPwSaving(true);
    setPwMsg(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwSaving(false);
    if (error) {
      setPwMsg({ ok: false, text: error.message });
      return;
    }
    setPw("");
    setPw2("");
    setPwMsg({ ok: true, text: "Password updated." });
  };

  return (
    <div className="animate-fade-in" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader title="My Profile" />

      <main className="container" style={{ flex: 1, maxWidth: "620px" }}>
        {/* Account */}
        <div className="glass-panel" style={{ padding: "1.75rem", marginTop: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <UserCog size={20} color="var(--accent-secondary)" />
            <h2 style={{ fontSize: "1.1rem" }}>Your account</h2>
          </div>

          {!supabase ? (
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
              Account features are unavailable because this app is not connected to its account service.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              <Row icon={<Mail size={16} />} label="Email" value={loaded ? email ?? " - " : "…"} />
              <Row
                icon={<ShieldCheck size={16} />}
                label="Role"
                value={loaded ? (role === "viewer" ? "Viewer (read-only)" : "Manager") : "…"}
              />
              {employeeName && (
                <Row icon={<IdCard size={16} />} label="Schedule name" value={employeeName} />
              )}
            </div>
          )}
        </div>

        {/* Display name - only for accounts linked to a roster name */}
        {supabase && loaded && employeeName && (
          <div className="glass-panel" style={{ padding: "1.75rem", marginTop: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
              <IdCard size={20} color="var(--accent-secondary)" />
              <h2 style={{ fontSize: "1.1rem" }}>Display name</h2>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
              How your name appears on the gameplan. Leave it blank to use your schedule name
              (<strong>{employeeName}</strong>).
            </p>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (displayMsg) setDisplayMsg(null);
                }}
                placeholder={employeeName}
                aria-label="Display name"
                style={{ ...inputStyle, flex: "1 1 200px" }}
              />
              <button
                onClick={saveDisplayName}
                className="btn-primary"
                disabled={displaySaving}
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", opacity: displaySaving ? 0.7 : 1, cursor: displaySaving ? "not-allowed" : "pointer" }}
              >
                {displaySaving ? <RefreshCw className="animate-spin" size={16} /> : <Save size={16} />}
                Save
              </button>
            </div>
            {displayMsg && <Notice ok={displayMsg.ok} text={displayMsg.text} />}
          </div>
        )}

        {/* Change password */}
        {supabase && (
          <div className="glass-panel" style={{ padding: "1.75rem", marginTop: "1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
              <KeyRound size={20} color="var(--accent-secondary)" />
              <h2 style={{ fontSize: "1.1rem" }}>Change password</h2>
            </div>
            <form onSubmit={savePassword} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>New password</span>
                <PasswordInput
                  autoComplete="new-password"
                  required
                  value={pw}
                  onChange={(v) => {
                    setPw(v);
                    if (pwMsg) setPwMsg(null);
                  }}
                  placeholder={`At least ${MIN_PASSWORD} characters`}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Confirm password</span>
                <PasswordInput
                  autoComplete="new-password"
                  required
                  value={pw2}
                  onChange={(v) => {
                    setPw2(v);
                    if (pwMsg) setPwMsg(null);
                  }}
                  placeholder="Re-enter your new password"
                />
              </label>
              <button
                type="submit"
                className="btn-primary"
                disabled={pwSaving}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", opacity: pwSaving ? 0.7 : 1, cursor: pwSaving ? "not-allowed" : "pointer" }}
              >
                {pwSaving ? <RefreshCw className="animate-spin" size={18} /> : <KeyRound size={18} />}
                {pwSaving ? "Saving…" : "Update password"}
              </button>
              {pwMsg && <Notice ok={pwMsg.ok} text={pwMsg.text} />}
            </form>
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
      <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{icon}</span>
      <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", minWidth: "110px" }}>{label}</span>
      <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Notice({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginTop: "0.75rem",
        padding: "0.6rem 0.75rem",
        borderRadius: "var(--radius-md)",
        fontSize: "0.825rem",
        color: ok ? "var(--task-b-text)" : "var(--alert-text)",
        backgroundColor: ok ? "var(--task-b-bg)" : "var(--alert-bg)",
      }}
    >
      {ok ? <CheckCircle2 size={16} style={{ flexShrink: 0 }} /> : <AlertCircle size={16} style={{ flexShrink: 0 }} />}
      <span>{text}</span>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.6rem 0.75rem",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-color)",
  backgroundColor: "var(--bg-primary)",
  color: "var(--text-primary)",
  fontFamily: "inherit",
  fontSize: "0.9rem",
  width: "100%",
};
