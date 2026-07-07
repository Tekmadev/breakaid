/**
 * proxy.ts - Next.js 16 request interceptor (formerly "middleware").
 *
 * Runs in front of every matched route to enforce login: unauthenticated
 * requests are redirected to /login before any page is served, and the Supabase
 * session cookie is refreshed on the way through. See src/lib/supabaseProxy.ts.
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabaseProxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on everything except Next's static assets and image files. Auth gating
  // should cover all real routes (including the data requests for client pages).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
