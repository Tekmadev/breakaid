/**
 * /api/admin/users — manager-only account administration.
 *
 * GET    → list all accounts (id, email, role, linked employee, timestamps)
 * POST   → create an account  { email, password, role, employeeName? }
 * PATCH  → update an account  { id, password?, role, employeeName? }
 * DELETE → remove an account  { id }
 *
 * Security model:
 *  - Every method first verifies the CALLER is a signed-in manager via the
 *    session cookies (see supabaseServer.ts). Viewers and anonymous callers
 *    get 403/401 — the proxy also bounces them, but this guard is the real
 *    boundary for direct API calls.
 *  - Mutations use the service_role key (SUPABASE_SERVICE_ROLE_KEY). That key
 *    is a SERVER-ONLY secret: no NEXT_PUBLIC_ prefix, so Next.js never inlines
 *    it into the browser bundle. It must never appear in client code.
 *  - role / employee_name are written to app_metadata, which only this admin
 *    API can set — users cannot edit their own app_metadata, so a viewer can
 *    never promote themselves.
 *  - You cannot demote or delete YOUR OWN account (lockout protection).
 *  - THE DEVELOPER ACCOUNT (app_metadata.developer === true) is untouchable:
 *    no manager can change its role, link, password, or delete it — only the
 *    developer themself may update their own password. This API NEVER writes
 *    the developer flag, so it cannot be granted or revoked from the app;
 *    it was set once, server-side, and is permanent.
 */

import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerUser, isManager } from "@/lib/supabaseServer";

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

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** 401 for anonymous, 403 for non-managers, 500 if the service key is absent. */
async function requireManagerAndAdmin() {
  const user = await getServerUser();
  if (!user) {
    return { error: Response.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!isManager(user)) {
    return { error: Response.json({ error: "Managers only." }, { status: 403 }) };
  }
  const admin = adminClient();
  if (!admin) {
    return {
      error: Response.json(
        { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY — add it to .env.local (server-only) and restart." },
        { status: 500 }
      ),
    };
  }
  return { caller: user, admin };
}

const asRole = (v: unknown): Role => (v === "viewer" ? "viewer" : "manager");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- GoTrue's User shape
function summarize(u: any): UserSummary {
  const meta = (u.app_metadata ?? {}) as {
    role?: string;
    developer?: boolean;
    employee_name?: string | null;
  };
  return {
    id: u.id,
    email: u.email ?? "",
    role: asRole(meta.role),
    developer: meta.developer === true,
    employeeName: meta.employee_name ?? null,
    createdAt: u.created_at ?? null,
    lastSignInAt: u.last_sign_in_at ?? null,
  };
}

export async function GET() {
  const gate = await requireManagerAndAdmin();
  if ("error" in gate) return gate.error;

  const { data, error } = await gate.admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const users = data.users
    .map(summarize)
    .sort((a, b) => a.email.localeCompare(b.email));
  return Response.json({ users, callerId: gate.caller.id });
}

export async function POST(request: NextRequest) {
  const gate = await requireManagerAndAdmin();
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    password?: string;
    role?: string;
    employeeName?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const role = asRole(body?.role);
  const employeeName = body?.employeeName?.trim() || null;

  const { data, error } = await gate.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email — the manager hands out credentials
    app_metadata: { role, employee_name: employeeName },
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ user: summarize(data.user) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireManagerAndAdmin();
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    password?: string;
    role?: string;
    employeeName?: string | null;
  } | null;
  if (!body?.id) return Response.json({ error: "Missing user id." }, { status: 400 });

  // Developer-account shield: fetch the target's current metadata first.
  const { data: target, error: fetchErr } = await gate.admin.auth.admin.getUserById(body.id);
  if (fetchErr || !target.user) {
    return Response.json({ error: fetchErr?.message ?? "User not found." }, { status: 404 });
  }
  const targetMeta = (target.user.app_metadata ?? {}) as { developer?: boolean };
  const targetIsDeveloper = targetMeta.developer === true;
  if (targetIsDeveloper && body.id !== gate.caller.id) {
    return Response.json(
      { error: "The developer account can only be modified by the developer." },
      { status: 403 }
    );
  }

  // The developer account is pinned to manager rights; everyone else follows
  // the requested role.
  const role = targetIsDeveloper ? "manager" : asRole(body.role);
  if (body.id === gate.caller.id && role !== "manager") {
    return Response.json(
      { error: "You can't demote your own account — ask the other manager." },
      { status: 400 }
    );
  }
  if (typeof body.password === "string" && body.password.length > 0 && body.password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  // app_metadata is sent WHOLE (role + employee link together) because the
  // admin update replaces the object rather than merging keys. The developer
  // flag is carried through unchanged — this API never grants or revokes it.
  const attrs: {
    password?: string;
    app_metadata: { role: Role; developer?: boolean; employee_name: string | null };
  } = {
    app_metadata: {
      role,
      ...(targetIsDeveloper ? { developer: true } : {}),
      employee_name: body.employeeName?.trim() || null,
    },
  };
  if (body.password) attrs.password = body.password;

  const { data, error } = await gate.admin.auth.admin.updateUserById(body.id, attrs);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ user: summarize(data.user) });
}

export async function DELETE(request: NextRequest) {
  const gate = await requireManagerAndAdmin();
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) return Response.json({ error: "Missing user id." }, { status: 400 });
  if (body.id === gate.caller.id) {
    return Response.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  // The developer account can never be deleted — by anyone.
  const { data: target } = await gate.admin.auth.admin.getUserById(body.id);
  if ((target?.user?.app_metadata as { developer?: boolean } | undefined)?.developer === true) {
    return Response.json({ error: "The developer account cannot be deleted." }, { status: 403 });
  }

  const { error } = await gate.admin.auth.admin.deleteUser(body.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ ok: true });
}
