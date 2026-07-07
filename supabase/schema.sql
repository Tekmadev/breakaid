-- BreakAid — canonical Supabase schema (Postgres).
--
-- FRESH PROJECT? Run this whole file once, then you're done.
-- EXISTING PROJECT (pre-MVP tables already created)? Run migration-mvp.sql
-- instead — it upgrades in place and is safe to re-run.
--
-- Access model (the repo is PUBLIC and ships the anon key, so RLS is the real
-- boundary):
--   • Roles live in each account's app_metadata JWT claim — "manager" or
--     "viewer" — written ONLY by the in-app admin API (service_role key).
--   • employees:  managers only (read + write).
--   • gameplans:  any signed-in user can READ (the /view phone page);
--                 only managers can write. Audit columns are trigger-stamped.
--   • The anon key alone (no session) can neither read nor write anything.

-- ---------------------------------------------------------------------------
-- Role helper — is the caller a manager? Missing role counts as manager so
-- the original pre-roles account never locks out (backfill in migration-mvp).
-- ---------------------------------------------------------------------------
create or replace function public.is_manager()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'manager') = 'manager';
$$;

-- ---------------------------------------------------------------------------
-- employees — persisted per-person settings the generator reads every build.
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  name        text primary key,             -- display name; the app's key
  position    text,                          -- e.g. "086-Security", "MBR SRV"
  can_walk    boolean not null default true,
  can_sec     boolean not null default false,
  door_side   text    not null default 'both'
              check (door_side in ('both', 'in', 'out')),
  last_shift  text,                          -- most recent shift label seen
  updated_at  timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

alter table public.employees enable row level security;
drop policy if exists "anon full access to employees" on public.employees;
drop policy if exists "authenticated full access to employees" on public.employees;
drop policy if exists "managers full access to employees" on public.employees;
create policy "managers full access to employees"
  on public.employees for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ---------------------------------------------------------------------------
-- gameplans — finalized day plans (the printable Member Service Gameplan).
-- Keyed by date label; `save` upserts so re-finalizing a day overwrites it.
-- created_by*/updated_by* are stamped server-side from the caller's JWT.
-- ---------------------------------------------------------------------------
create table if not exists public.gameplans (
  plan_date        text primary key,        -- date label, e.g. "Thu 06/18/2026"
  is_weekend       boolean not null default false,
  roster           jsonb   not null default '[]'::jsonb, -- Employee[] snapshot
  plan             jsonb   not null default '{}'::jsonb, -- name -> slot -> code
  finalized_at     timestamptz not null default now(),
  created_by       uuid,
  created_by_email text,
  updated_by       uuid,
  updated_by_email text
);

create or replace function public.set_gameplan_audit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_email := auth.jwt() ->> 'email';
    new.updated_by := new.created_by;
    new.updated_by_email := new.created_by_email;
  else
    new.created_by := old.created_by;            -- immutable after creation
    new.created_by_email := old.created_by_email;
    new.updated_by := auth.uid();
    new.updated_by_email := auth.jwt() ->> 'email';
  end if;
  new.finalized_at := now();
  return new;
end;
$$;

drop trigger if exists gameplans_audit on public.gameplans;
create trigger gameplans_audit
  before insert or update on public.gameplans
  for each row execute function public.set_gameplan_audit();

alter table public.gameplans enable row level security;
drop policy if exists "authenticated full access to gameplans" on public.gameplans;
drop policy if exists "authenticated read gameplans" on public.gameplans;
drop policy if exists "managers insert gameplans" on public.gameplans;
drop policy if exists "managers update gameplans" on public.gameplans;
drop policy if exists "managers delete gameplans" on public.gameplans;

create policy "authenticated read gameplans"
  on public.gameplans for select to authenticated
  using (true);
create policy "managers insert gameplans"
  on public.gameplans for insert to authenticated
  with check (public.is_manager());
create policy "managers update gameplans"
  on public.gameplans for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy "managers delete gameplans"
  on public.gameplans for delete to authenticated
  using (public.is_manager());
