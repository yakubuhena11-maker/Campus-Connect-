-- Campus Connect core Supabase schema.
-- Paste this file into the Supabase SQL Editor and run as the project owner.
-- This script is safe to re-run for the tables, functions, and named policies below.

begin;

-- -----------------------------------------------------------------------------
-- Profiles
-- One row per Supabase Auth user. Auth remains the source of truth for identity;
-- profile fields are used for Campus Connect display and authorization.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  matric_number text unique,
  email text,
  role text not null default 'student'
    check (role in ('student', 'admin')),
  status text not null default 'active'
    check (status in ('active', 'muted', 'suspended')),
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Campus Connect profile data and access role/status for each Supabase Auth user.';
comment on column public.profiles.id is
  'Matches auth.users.id; deleting the Auth user cascades to this profile.';
comment on column public.profiles.full_name is 'Display name supplied during registration.';
comment on column public.profiles.matric_number is 'Unique student matriculation number; nullable if not supplied.';
comment on column public.profiles.role is 'Authorization role; only a trusted admin or project owner may grant admin.';
comment on column public.profiles.status is 'Account status: active, muted, or suspended.';
comment on column public.profiles.avatar_url is 'Optional URL for the user profile avatar.';

-- Add missing columns when upgrading a database created from an earlier schema.
alter table public.profiles
  add column if not exists full_name text not null default '',
  add column if not exists matric_number text,
  add column if not exists email text,
  add column if not exists role text not null default 'student',
  add column if not exists status text not null default 'active',
  add column if not exists avatar_url text,
  add column if not exists created_at timestamptz not null default now();

-- Ensure the fields retain the required allowed values when upgrading older tables.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_role_allowed_values'
  ) then
    alter table public.profiles add constraint profiles_role_allowed_values
      check (role in ('student', 'admin'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_status_allowed_values'
  ) then
    alter table public.profiles add constraint profiles_status_allowed_values
      check (status in ('active', 'muted', 'suspended'));
  end if;
end;
$$;

create unique index if not exists profiles_matric_number_unique_idx
  on public.profiles (matric_number)
  where matric_number is not null;

-- -----------------------------------------------------------------------------
-- Admin helper
-- SECURITY DEFINER lets the policy check the profiles table without recursively
-- invoking its own RLS policies. The fixed search_path and qualified names avoid
-- relying on caller-controlled object resolution.
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'admin'
  );
$$;
comment on function public.is_admin() is
  'Returns true when the signed-in user has the admin role; used by RLS policies.';

-- -----------------------------------------------------------------------------
-- Signup profile creation and existing-user backfill.
-- Supabase signup metadata keys match the frontend: full_name and
-- matriculation_number. Empty matriculation numbers are stored as NULL.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, matric_number, email)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'matriculation_number'), ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
comment on function public.handle_new_auth_user() is
  'Creates a student profile after a new Supabase Auth user is inserted.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill Auth accounts that existed before the signup trigger was installed.
-- Existing profile rows are preserved; duplicate matric numbers should be
-- reviewed before running if earlier data was imported inconsistently.
insert into public.profiles (id, full_name, matric_number, email)
select
  auth_user.id,
  coalesce(nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''), ''),
  nullif(btrim(auth_user.raw_user_meta_data ->> 'matriculation_number'), ''),
  auth_user.email
from auth.users as auth_user
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Audit logs
-- Append-only administrative activity. The FK references are nullable so audit
-- history remains if an account is later removed.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_user_id uuid references public.profiles (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.audit_logs is
  'Administrative audit trail; browser clients may append and read as admins only.';
comment on column public.audit_logs.details is 'Structured metadata for the recorded administrative action.';

-- -----------------------------------------------------------------------------
-- Prevent non-admins from changing any profile field other than full_name and
-- avatar_url. RLS handles which rows may be reached; this trigger restricts the
-- writable columns while leaving admins able to manage all profile fields.
-- -----------------------------------------------------------------------------
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() and (
    new.id is distinct from old.id
    or new.matric_number is distinct from old.matric_number
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.status is distinct from old.status
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Students may update only their full_name and avatar_url.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
comment on function public.protect_profile_fields() is
  'Blocks non-admin changes to profile columns other than full_name and avatar_url.';

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
before update on public.profiles
for each row execute function public.protect_profile_fields();

-- -----------------------------------------------------------------------------
-- Row Level Security and grants
-- RLS controls rows; SQL grants control which operations the API can attempt.
-- No anonymous access is granted to either table.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table public.profiles, public.audit_logs from public, anon, authenticated;
grant select, update on table public.profiles to authenticated;
grant select, insert on table public.audit_logs to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Remove policies created by earlier versions of this schema before defining
-- the complete intended policy set.
drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_update_self_or_admin on public.profiles;
drop policy if exists profiles_select_self_or_admin_v2 on public.profiles;
drop policy if exists profiles_update_self_or_admin_v2 on public.profiles;
drop policy if exists audit_logs_select_admin on public.audit_logs;
drop policy if exists audit_logs_insert_admin on public.audit_logs;
drop policy if exists audit_logs_select_admin_v2 on public.audit_logs;
drop policy if exists audit_logs_insert_admin_v2 on public.audit_logs;

-- Students read their own profile; admins read all profiles.
create policy profiles_select_self_or_admin_v2
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

-- Students may update their own row; protect_profile_fields() limits changes to
-- full_name/avatar_url. Admins may update any profile and its role/status.
create policy profiles_update_self_or_admin_v2
on public.profiles
for update
to authenticated
using (id = (select auth.uid()) or (select public.is_admin()))
with check (id = (select auth.uid()) or (select public.is_admin()));

-- Only admins can read or append audit entries. There are deliberately no
-- update or delete policies, keeping entries immutable through the Data API.
create policy audit_logs_select_admin_v2
on public.audit_logs
for select
to authenticated
using ((select public.is_admin()));

create policy audit_logs_insert_admin_v2
on public.audit_logs
for insert
to authenticated
with check (
  admin_id = (select auth.uid())
  and (select public.is_admin())
);

-- -----------------------------------------------------------------------------
-- First-admin bootstrap (manual, trusted SQL Editor only):
-- 1. Register and confirm your own account through Supabase Auth.
-- 2. Run the following in the Supabase SQL Editor, replacing the email:
--      update public.profiles
--      set role = 'admin', status = 'active'
--      where email = 'your-account@example.edu';
-- 3. Verify that exactly the intended profile was promoted.
-- Never expose the SQL Editor/project-owner credentials or grant admin from the
-- public signup flow.
-- -----------------------------------------------------------------------------

commit;
