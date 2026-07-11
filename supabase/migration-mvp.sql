-- ═══════════════════════════════════════════════════════════════════════════
-- BreakAid MVP migration - run ONCE in the Supabase SQL editor (safe to re-run).
-- Adds: door-side restriction, manager/viewer roles, gameplan audit trail,
-- and role-aware row-level security.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Door-side restriction on employees ───────────────────────────────────
-- "both" (default) rotates entrance/exit fairly; "in" = entrance ONLY
-- (medical accommodation); "out" = exit ONLY.
alter table public.employees
  add column if not exists door_side text not null default 'both'
  check (door_side in ('both', 'in', 'out'));

-- ── 1b) Display name (friendlier label shown on the gameplan; roster `name`
-- stays the key that matches the schedule file). Nullable = fall back to name.
alter table public.employees
  add column if not exists display_name text;

-- ── 2) Roles ─────────────────────────────────────────────────────────────────
-- Roles live in each account's app_metadata (inside the JWT). Only the admin
-- API (service_role) can write app_metadata - users cannot change their own.
-- Backfill: any existing account without a role becomes a manager (that's the
-- original account created before roles existed).
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"manager"}'::jsonb
where coalesce(raw_app_meta_data ->> 'role', '') = '';

-- Helper read by every policy below: is the caller a manager?
-- A missing role counts as VIEWER (least privilege): the backfill above gives
-- every existing account an explicit role, so only a stray or self-registered
-- account is roleless, and it must never inherit manager access.
create or replace function public.is_manager()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'viewer') = 'manager';
$$;

-- ── 3) employees: managers only (viewers never need roster settings) ────────
alter table public.employees enable row level security;
drop policy if exists "anon full access to employees" on public.employees;
drop policy if exists "authenticated full access to employees" on public.employees;
drop policy if exists "managers full access to employees" on public.employees;
create policy "managers full access to employees"
  on public.employees for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ── 4) gameplans: audit columns + trigger ────────────────────────────────────
-- created_by* = who first finalized the day; updated_by* = who last modified
-- it. Stamped server-side from the caller's JWT - the app never sends these,
-- so they cannot be forged.
alter table public.gameplans add column if not exists created_by uuid;
alter table public.gameplans add column if not exists created_by_email text;
alter table public.gameplans add column if not exists updated_by uuid;
alter table public.gameplans add column if not exists updated_by_email text;

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

-- ── 5) gameplans: viewers read, managers write ───────────────────────────────
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

-- ── 6) Self-service display name (staff /profile page) ───────────────────────
-- A viewer has NO direct access to the employees table; these SECURITY DEFINER
-- helpers let an account read and set ONLY its own display name, matched by its
-- app_metadata employee_name claim.
create or replace function public.get_my_display_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select display_name from public.employees
  where name = auth.jwt() -> 'app_metadata' ->> 'employee_name';
$$;

create or replace function public.set_my_display_name(new_display_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  my_name text := auth.jwt() -> 'app_metadata' ->> 'employee_name';
begin
  if my_name is null or my_name = '' then
    raise exception 'This account is not linked to a schedule name.';
  end if;
  update public.employees
    set display_name = nullif(btrim(new_display_name), '')
    where name = my_name;
  if not found then
    insert into public.employees (name, display_name)
      values (my_name, nullif(btrim(new_display_name), ''));
  end if;
end;
$$;

revoke all on function public.get_my_display_name() from public;
revoke all on function public.set_my_display_name(text) from public;
grant execute on function public.get_my_display_name() to authenticated;
grant execute on function public.set_my_display_name(text) to authenticated;
