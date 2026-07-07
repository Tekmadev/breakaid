/**
 * supabaseServer.ts - Server-side Supabase helpers for Route Handlers.
 *
 * `getServerUser()` reads the caller's session from the request cookies and
 * returns a VERIFIED user (auth.getUser() round-trips to the Auth server), or
 * null. Cookie writes are a no-op here - token refresh is the proxy's job
 * (src/proxy.ts runs on every matched request before any handler).
 *
 * Roles live in the JWT's app_metadata (server-controlled). Every account
 * created through the admin API gets an explicit role, and the migration SQL
 * backfills the original pre-roles account to manager. A missing role is
 * treated as "viewer" (least privilege), so a stray or self-registered account
 * can never gain manager access by default.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

export async function getServerUser(): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll() {
        // Read-only guard: refreshed cookies are written by the proxy pass.
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export function isManager(user: User | null): boolean {
  if (!user) return false;
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  return role === "manager"; // least privilege: only an explicit manager qualifies
}
