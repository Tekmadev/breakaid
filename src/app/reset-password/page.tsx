"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, AlertCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import PasswordInput from "@/components/PasswordInput";

/**
 * /reset-password - where the Supabase recovery email link lands. Public route
 * (PUBLIC_PREFIXES in supabaseProxy.ts). The recovery link establishes a short
 * lived session; the browser client's detectSessionInUrl processes the token on
 * load and fires PASSWORD_RECOVERY, after which updateUser({ password }) sets
 * the new password. If no recovery session appears, the link was invalid or
 * expired.
 */
type Phase = "checking" | "ready" | "invalid" | "done";

const MIN_PASSWORD = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(() => (supabase ? "checking" : "invalid"));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(
    supabase ? null : "This app is not connected to its account service, so password reset is unavailable."
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    // detectSessionInUrl (default on the browser client) parses the recovery
    // token from the URL and emits PASSWORD_RECOVERY once the session is set.
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setPhase((p) => (p === "checking" ? "ready" : p));
      }
    });

    // In case the session was already established before the listener attached,
    // check directly; if still nothing after a short grace period, the link is
    // not valid.
    client.auth.getSession().then(({ data }) => {
      if (data.session) {
        setPhase((p) => (p === "checking" ? "ready" : p));
      } else {
        setTimeout(() => setPhase((p) => (p === "checking" ? "invalid" : p)), 1600);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSaving(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    // Drop the temporary recovery session so the new password must be used to
    // sign in fresh, then send them to the login screen.
    await supabase.auth.signOut();
    setSaving(false);
    setPhase("done");
    setTimeout(() => router.replace("/login"), 2500);
  }

  return (
    <div
      className="animate-fade-in"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        gap: "1.5rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://upload.wikimedia.org/wikipedia/commons/5/59/Costco_Wholesale_logo_2010-10-26.svg"
          alt="Costco Wholesale"
          style={{ height: "36px" }}
        />
        <span
          style={{
            color: "var(--accent-secondary)",
            fontWeight: 600,
            fontSize: "1.25rem",
            borderLeft: "2px solid var(--border-color)",
            paddingLeft: "1rem",
          }}
        >
          BreakAid Gameplan
        </span>
      </div>

      <div
        className="glass-panel"
        style={{ padding: "2rem", width: "100%", maxWidth: "380px", display: "flex", flexDirection: "column", gap: "1rem" }}
      >
        {phase === "checking" && (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)" }}>
            <RefreshCw className="animate-spin" size={18} /> Verifying your reset link…
          </div>
        )}

        {phase === "invalid" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <AlertCircle size={18} color="var(--alert-text)" />
              <h2 style={{ fontSize: "1.1rem" }}>Reset link not valid</h2>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: 1.5 }}>
              {error ?? "This password reset link is invalid or has expired."} Please request a new one.
            </p>
            <a href="/forgot-password" className="btn-primary" style={{ textAlign: "center", textDecoration: "none" }}>
              Request a new link
            </a>
          </>
        )}

        {phase === "ready" && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <KeyRound size={18} color="var(--accent-secondary)" />
              <h2 style={{ fontSize: "1.1rem" }}>Choose a new password</h2>
            </div>

            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>New password</span>
              <PasswordInput
                autoComplete="new-password"
                required
                value={password}
                onChange={(value) => {
                  setPassword(value);
                  if (error) setError(null);
                }}
                placeholder={`At least ${MIN_PASSWORD} characters`}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Confirm password</span>
              <PasswordInput
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(value) => {
                  setConfirm(value);
                  if (error) setError(null);
                }}
                placeholder="Re-enter your new password"
              />
            </label>

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
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={saving}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                marginTop: "0.25rem",
                opacity: saving ? 0.7 : 1,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? <RefreshCw className="animate-spin" size={18} /> : <KeyRound size={18} />}
              {saving ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}

        {phase === "done" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <CheckCircle2 size={18} color="var(--accent-secondary)" />
              <h2 style={{ fontSize: "1.1rem" }}>Password updated</h2>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: 1.5 }}>
              Your password has been changed. Redirecting you to sign in…
            </p>
            <a href="/login" className="btn-primary" style={{ textAlign: "center", textDecoration: "none" }}>
              Go to sign in
            </a>
          </>
        )}
      </div>
    </div>
  );
}
