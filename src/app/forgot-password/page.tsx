"use client";

import React, { useState } from "react";
import { Mail, AlertCircle, RefreshCw, CheckCircle2, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

/**
 * /forgot-password - request a password reset email. Public route (added to
 * PUBLIC_PREFIXES in supabaseProxy.ts). Sends the user to /reset-password via
 * the Supabase recovery link. We always show the same "check your inbox"
 * confirmation whether or not the address exists, so this page cannot be used
 * to probe which emails have accounts.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Password reset is unavailable: this app is not connected to its account service.");
      return;
    }
    setLoading(true);
    setError(null);
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSent(true);
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
        {sent ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <CheckCircle2 size={18} color="var(--accent-secondary)" />
              <h2 style={{ fontSize: "1.1rem" }}>Check your inbox</h2>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", lineHeight: 1.5 }}>
              If an account exists for <strong>{email.trim()}</strong>, a password reset link is on its
              way. Open it on this device if you can, then choose a new password. The link expires after a
              while, so use it soon. Remember to check your spam folder.
            </p>
            <a
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                color: "var(--accent-secondary)",
                textDecoration: "none",
                fontSize: "0.85rem",
                marginTop: "0.25rem",
              }}
            >
              <ArrowLeft size={16} /> Back to sign in
            </a>
          </>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <Mail size={18} color="var(--accent-secondary)" />
              <h2 style={{ fontSize: "1.1rem" }}>Reset your password</h2>
            </div>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "-0.5rem" }}>
              Enter the email your manager set up for you and we will send a reset link.
            </p>

            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Email</span>
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="you@example.com"
                style={inputStyle}
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
              disabled={loading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                marginTop: "0.25rem",
                opacity: loading ? 0.7 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? <RefreshCw className="animate-spin" size={18} /> : <Mail size={18} />}
              {loading ? "Sending…" : "Send reset link"}
            </button>

            <a
              href="/login"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                color: "var(--text-secondary)",
                textDecoration: "none",
                fontSize: "0.82rem",
              }}
            >
              <ArrowLeft size={16} /> Back to sign in
            </a>
          </form>
        )}
      </div>

      <nav style={{ display: "flex", gap: "1.25rem", fontSize: "0.8rem" }}>
        <a href="/about" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>About</a>
        <a href="/terms" style={{ color: "var(--text-secondary)", textDecoration: "none" }}>Terms &amp; Privacy</a>
      </nav>
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
