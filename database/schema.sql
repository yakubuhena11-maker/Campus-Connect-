-- Campus Connect starter schema for Supabase.
-- Paste this file into the Supabase SQL Editor and run it as the project owner.
-- Client access is controlled by Row Level Security (RLS); never ship a service-role key.

-- -----------------------------------------------------------------------------
-- Student profiles
-- One profile is created for each auth.users row by the trigger below.
-- matric_number is nullable so signups can be completed before collecting it.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  matric_number text unique,
  email text,
  role text not null default 'student' check (role in ('student', 'admin')),
  status text not null default 'active' check (status in ('active', 'muted', 'suspended')),
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Campus Connect user profile and account moderation state.';
comment on column public.profiles.matric_number is 'Unique student matriculation number; nullable until supplied.';
comment on column public.profiles.role is 'Authorization role. Only trusted administrators should grant admin.';
comment on column public.profiles.status is 'Account status controlling user-generated writes.';

-- -----------------------------------------------------------------------------
-- Future feature tables
-- These are intentionally minimal starter schemas; add feature-specific fields
-- and validation as product requirements are finalized.
-- -----------------------------------------------------------------------------
create table if not exists public.lost_found_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_type text not null check (item_type in ('lost', 'found')),
  title text not null,
  description text not null default '',
  location text,
  item_date date,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.lost_found_items is 'Starter records for lost and found campus items.';

create table if not exists public.student_voice_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.student_voice_posts is 'Starter records for student feedback and voice posts.';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.notifications is 'Per-user notifications; create these from trusted server-side code.';

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_user_id uuid references public.profiles (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.audit_logs is 'Administrative audit trail. Entries are immutable to browser clients.';

-- -----------------------------------------------------------------------------
-- Security helper functions
-- SECURITY DEFINER allows these checks to inspect profiles without recursing
-- through profiles' own RLS policies. The fixed empty search_path and qualified
-- table names prevent object-shadowing attacks.
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
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.status = 'active'
  );
$$;
comment on function public.is_admin() is 'True only for the signed-in active admin profile; used by RLS policies.';

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.status = 'active'
  );
$$;
comment on function public.is_active_user() is 'True only when the signed-in user has active status.';

-- Prevent ordinary users from changing their own role/status (or profile id and
-- creation timestamp). Admin profile updates are allowed by the RLS policy below.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.id is distinct from old.id
       or new.created_at is distinct from old.created_at then
      raise exception 'Only an active admin can change privileged profile fields.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

 drop trigger if exists profiles_protect_privileged_fields on public.profiles;
create trigger profiles_protect_privileged_fields
before update on public.profiles
for each row execute function public.protect_profile_privileged_fields();

-- Create a profile during Supabase Auth signup. Supports the metadata key used
-- by the starter signup form and the shorter matric_number key for other clients.
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
    nullif(btrim(coalesce(
      new.raw_user_meta_data ->> 'matric_number',
      new.raw_user_meta_data ->> 'matriculation_number'
    )), ''),
    new.email
  );
  return new;
end;
$$;

 drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Keep profile email in sync when the Auth email changes.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

 drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.sync_profile_email();

-- -----------------------------------------------------------------------------
-- Enable RLS on every application table.
-- Explicit authenticated grants make the tables usable through Supabase's
-- Data API; the policies below still restrict which rows and operations apply.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.lost_found_items enable row level security;
alter table public.student_voice_posts enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles, public.lost_found_items, public.student_voice_posts,
  public.notifications, public.audit_logs from anon;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.lost_found_items to authenticated;
grant select, insert, update, delete on public.student_voice_posts to authenticated;
grant select, update on public.notifications to authenticated;
grant select, insert on public.audit_logs to authenticated;

-- Profiles: a student can read/update their own row; active admins can read and
-- update any profile. The trigger above blocks students changing role/status.
create policy profiles_select_self_or_admin
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update_self_or_admin
on public.profiles for update to authenticated
using (
  (id = (select auth.uid()) and status <> 'suspended')
  or (select public.is_admin())
)
with check (
  (id = (select auth.uid()) and status <> 'suspended')
  or (select public.is_admin())
);

-- Lost and found: visible to signed-in users; an active author may create,
-- update, or remove their own records. Muted users cannot post; suspended users
-- fail the active-user check and therefore have no write access.
create policy lost_found_select_signed_in
on public.lost_found_items for select to authenticated
using (true);
create policy lost_found_insert_active_owner
on public.lost_found_items for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.is_active_user()));
create policy lost_found_update_active_owner_or_admin
on public.lost_found_items for update to authenticated
using (
  (user_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
)
with check (
  (user_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
);
create policy lost_found_delete_active_owner_or_admin
on public.lost_found_items for delete to authenticated
using (
  (user_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
);

-- Student voice: same ownership and active-status rules as lost and found.
create policy student_voice_select_signed_in
on public.student_voice_posts for select to authenticated
using (true);
create policy student_voice_insert_active_owner
on public.student_voice_posts for insert to authenticated
with check (author_id = (select auth.uid()) and (select public.is_active_user()));
create policy student_voice_update_active_owner_or_admin
on public.student_voice_posts for update to authenticated
using (
  (author_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
)
with check (
  (author_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
);
create policy student_voice_delete_active_owner_or_admin
on public.student_voice_posts for delete to authenticated
using (
  (author_id = (select auth.uid()) and (select public.is_active_user()))
  or (select public.is_admin())
);

-- Notifications: users can read/update only their own and only while active.
-- Trusted backend code should create notification rows; there is no client
-- insert policy. Admins can read all notifications but cannot rewrite them here.
create policy notifications_select_owner_or_admin
on public.notifications for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy notifications_update_active_owner
on public.notifications for update to authenticated
using (user_id = (select auth.uid()) and (select public.is_active_user()))
with check (user_id = (select auth.uid()) and (select public.is_active_user()));

-- Audit logs: admins can read and append records attributed to themselves.
-- No update/delete policies are provided, so client-side records are immutable.
create policy audit_logs_select_admin
on public.audit_logs for select to authenticated
using ((select public.is_admin()));
create policy audit_logs_insert_admin
on public.audit_logs for insert to authenticated
with check (admin_id = (select auth.uid()) and (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- First admin bootstrap (run manually after registering your own account):
-- 1. Sign up normally through Campus Connect and confirm the email if required.
-- 2. In the Supabase SQL Editor, find the row by the account email and promote it:
--      update public.profiles
--      set role = 'admin', status = 'active'
--      where email = 'your-account@example.edu';
-- 3. Verify exactly one intended account was changed before using admin features.
-- Run this only from the trusted SQL Editor as the project owner, never from the
-- browser. There is deliberately no public/admin self-signup mechanism.
-- -----------------------------------------------------------------------------
