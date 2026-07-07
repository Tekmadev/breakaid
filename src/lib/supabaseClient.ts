/**
 * supabaseClient.ts - Single shared Supabase BROWSER client (cookie-based).
 *
 * Uses `@supabase/ssr`'s `createBrowserClient`, which stores the auth session in
 * cookies (via `document.cookie`) rather than localStorage. That is what lets
 * the server-side `proxy.ts` read the session and gate every request. With no
 * cookie methods passed, the browser client uses the document.cookie fallback.
 *
 * The URL + anon (publishable) key come from NEXT_PUBLIC_ env vars, so they are
 * inlined into the bundle. That is expected for Supabase: the anon key ships
 * publicly and real access control is enforced by Row Level Security (which is
 * now scoped to authenticated users - see supabase/schema.sql).
 *
 * If the env vars are absent, `supabase` is null and `hasSupabaseEnv` is false,
 * so callers fall back to localStorage and the app still works unconfigured.
 */

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True only when both env vars are present, so we can talk to Supabase. */
export const hasSupabaseEnv = Boolean(url && anonKey);

/** The shared browser client, or null when Supabase isn't configured. */
export const supabase = hasSupabaseEnv
  ? createBrowserClient(url as string, anonKey as string)
  : null;
