"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, AlertCircle, RefreshCw, Lock } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import PasswordInput from "@/components/PasswordInput";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("Authentication is not configured. Set the Supabase env vars.");
      return;
    }
    if (!agreed) {
      setError("Please agree to the Terms of Use & Privacy Policy to continue.");
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setLoading(false);
      setError(error.message);
      return;
    }
    // Session cookies are now set; the proxy will allow the protected routes.
    // Viewers (door staff) land on the read-only /view page; managers on the
    // builder. refresh() re-runs the server pass so /login stops matching.
    const role = (data.user?.app_metadata as { role?: string } | undefined)?.role;
    router.replace(role === "viewer" ? "/view" : "/");
    router.refresh();
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

      <form
        onSubmit={handleSubmit}
        className="glass-panel"
        style={{
          padding: "2rem",
          width: "100%",
          maxWidth: "380px",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
          <Lock size={18} color="var(--accent-secondary)" />
          <h2 style={{ fontSize: "1.1rem" }}>Sign in</h2>
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "-0.5rem" }}>
          This tool is private. Sign in with the account your manager created for you.
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

        <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-secondary)" }}>Password</span>
          <PasswordInput
            autoComplete="current-password"
            required
            value={password}
            onChange={(value) => {
              setPassword(value);
              if (error) setError(null);
            }}
            placeholder="Your password"
          />
        </label>

        <div style={{ marginTop: "-0.5rem", textAlign: "right" }}>
          <a
            href="/forgot-password"
            style={{ fontSize: "0.8rem", color: "var(--accent-secondary)", textDecoration: "none" }}
          >
            Forgot password?
          </a>
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.5rem",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: 1.45,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (error) setError(null);
            }}
            style={{ marginTop: "0.15rem", flexShrink: 0, cursor: "pointer" }}
          />
          <span>
            I have read and agree to the{" "}
            <a href="/terms" style={{ color: "var(--accent-secondary)" }}>
              Terms of Use &amp; Privacy Policy
            </a>
            .
          </span>
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
          disabled={loading || !agreed}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            marginTop: "0.25rem",
            opacity: loading || !agreed ? 0.7 : 1,
            cursor: loading || !agreed ? "not-allowed" : "pointer",
          }}
        >
          {loading ? <RefreshCw className="animate-spin" size={18} /> : <LogIn size={18} />}
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

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
