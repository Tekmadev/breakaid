"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";

/** Signs the manager out (clears the session cookies) and returns to /login. */
export default function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    if (!supabase) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      title="Sign out"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        background: "none",
        border: "1px solid var(--border-color)",
        padding: "0.5rem 1rem",
        borderRadius: "var(--radius-md)",
        cursor: loading ? "not-allowed" : "pointer",
        color: "var(--text-secondary)",
        fontFamily: "inherit",
        fontSize: "0.9rem",
        opacity: loading ? 0.6 : 1,
      }}
    >
      <LogOut size={18} />
      Sign out
    </button>
  );
}
