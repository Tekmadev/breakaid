/**
 * supabaseProxy.ts - Server-side session refresh + auth gate used by proxy.ts.
 *
 * On every matched request this creates a server Supabase client bound to the
 * request/response cookies, calls `getUser()` (which verifies the token with the
 * Supabase Auth server AND refreshes it, writing fresh cookies onto the
 * response), and then redirects:
 *   - unauthenticated requests for any protected route  → /login
 *   - authenticated requests for /login                 → /
 *
 * `getUser()` is used rather than `getSession()` because it returns a verified
 * identity (getSession trusts the cookie without contacting the server). The
 * IMPORTANT ordering rule from @supabase/ssr is honored: getUser() runs before
 * we build the final response, so a refreshed session is never lost.
 *
 * ROLES - read from the JWT's app_metadata (server-controlled; users cannot
 * edit it): only an explicit "manager" gets the full app. Everyone else,
 * including "viewer" (door staff on their phones) and any account with no role,
 * is confined to the read-only /view page. The migration SQL backfills the
 * original pre-roles account to an explicit manager.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes reachable without a session. Everything else requires login. */
const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/about", "/terms"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // If Supabase isn't configured, don't lock anyone out - just pass through.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next({ request });

  // This response is mutated in setAll so refreshed auth cookies ride along.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Mirror cookies onto the request (for any downstream reads in this
        // pass) and onto a fresh response (what actually gets sent back).
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        // Prevent CDN/proxy caching of responses that set auth cookies.
        if (headers) {
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        }
      },
    },
  });

  // Verified identity (also refreshes the token + writes cookies via setAll).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Carry any just-refreshed auth cookies onto a redirect so they aren't lost.
  const redirectTo = (path: string) => {
    const dest = request.nextUrl.clone();
    dest.pathname = path;
    dest.search = "";
    const redirect = NextResponse.redirect(dest);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    return redirect;
  };

  if (!user && !isPublicPath(pathname)) {
    return redirectTo("/login");
  }

  if (user) {
    const role =
      (user.app_metadata as { role?: string } | undefined)?.role === "manager"
        ? "manager"
        : "viewer";
    const home = role === "viewer" ? "/view" : "/";
    if (pathname === "/login") {
      return redirectTo(home);
    }
    // Viewers are read-only: /view is their whole app. Everything else
    // (builder, employees, users admin, admin API) bounces back there - except
    // the public About / Terms pages, which everyone may read.
    if (
      role === "viewer" &&
      !isPublicPath(pathname) &&
      pathname !== "/view" &&
      !pathname.startsWith("/view/")
    ) {
      return redirectTo("/view");
    }
  }

  return response;
}
