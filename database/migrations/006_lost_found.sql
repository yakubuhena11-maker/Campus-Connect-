-- Lost & found feature schema and access controls.
-- Run this migration from the Supabase SQL Editor as the project owner.

begin;

-- can_post() centralizes the account-status check used by student write policies.
-- SECURITY DEFINER avoids recursive profile RLS checks; the empty search_path and
-- schema-qualified table keep object resolution safe. A missing profile is denied.
create or replace function public.can_post()
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
      and profile.status = 'active'
  );
$$;
comment on function public.can_post() is
  'True only when the authenticated user has an active profile; used to gate lost-and-found submissions and claims.';

-- Authenticated users need to evaluate can_post() inside row policies, but it
-- should not be callable by anonymous users.
revoke all on function public.can_post() from public, anon;
grant execute on function public.can_post() to authenticated;

-- Each lost/found report belongs to its submitter. Moderation is represented by
-- status; new reports always start pending and only admins can approve/reject.
create table if not exists public.lost_found_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('lost', 'found')),
  title text not null,
  description text not null,
  category text not null,
  location text not null,
  date_occurred date not null,
  image_path text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'claimed', 'rejected')),
  created_at timestamptz not null default now()
);
comment on table public.lost_found_items is
  'Lost and found reports, owned by a profile and moderated by administrators.';
comment on column public.lost_found_items.owner_id is
  'Profile that submitted the report; deleting that profile removes its reports.';
comment on column public.lost_found_items.image_path is
  'Optional object path in the private lost-found storage bucket.';
comment on column public.lost_found_items.status is
  'Moderation and lifecycle state; student-created reports must remain pending until an admin changes them.';

-- A claim links one claimant to one report. The unique constraint prevents the
-- same user from submitting duplicate claims for one item.
create table if not exists public.lost_found_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.lost_found_items (id) on delete cascade,
  claimant_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  constraint lost_found_claims_one_per_user_per_item unique (item_id, claimant_id)
);
comment on table public.lost_found_claims is
  'Claims submitted by users for approved reports; the report owner and admins can review them.';
comment on column public.lost_found_claims.status is
  'Claim review state; new claims are pending and only admins can update claims.';

-- Enable row-level security so access is determined by the policies below.
alter table public.lost_found_items enable row level security;
alter table public.lost_found_claims enable row level security;

-- Do not grant table writes to anonymous users. Authenticated access is limited
-- by the explicit RLS policies; admins use these same grants and policies.
revoke all on table public.lost_found_items, public.lost_found_claims from public, anon, authenticated;
grant select, insert, update on table public.lost_found_items to authenticated;
grant select, insert, update on table public.lost_found_claims to authenticated;

-- Remove this migration's named policies first so it can safely be re-run.
drop policy if exists lost_found_items_select_visible on public.lost_found_items;
drop policy if exists lost_found_items_insert_active_owner on public.lost_found_items;
drop policy if exists lost_found_items_update_pending_owner on public.lost_found_items;
drop policy if exists lost_found_items_admin_update on public.lost_found_items;
drop policy if exists lost_found_claims_select_participant_or_admin on public.lost_found_claims;
drop policy if exists lost_found_claims_insert_active_non_owner on public.lost_found_claims;
drop policy if exists lost_found_claims_admin_update on public.lost_found_claims;

-- Students can see approved reports and their own reports regardless of status.
-- Admins can read every report, including unapproved or rejected reports.
create policy lost_found_items_select_visible
on public.lost_found_items
for select
to authenticated
using (
  status = 'approved'
  or owner_id = (select auth.uid())
  or (select public.is_admin())
);

-- Only an active user may create a pending report for their own profile.
-- The status restriction blocks clients from self-approving a new report.
create policy lost_found_items_insert_active_owner
on public.lost_found_items
for insert
to authenticated
with check (
  owner_id = (select auth.uid())
  and status = 'pending'
  and (select public.can_post())
);

-- A student may edit their own report only while it remains pending. Requiring
-- pending in both USING and WITH CHECK makes changing status to any other value
-- impossible; ownership also cannot be transferred through an update.
create policy lost_found_items_update_pending_owner
on public.lost_found_items
for update
to authenticated
using (
  owner_id = (select auth.uid())
  and status = 'pending'
  and not (select public.is_admin())
)
with check (
  owner_id = (select auth.uid())
  and status = 'pending'
  and not (select public.is_admin())
);

-- Admins may update any report, including moderation status and ownership fields.
create policy lost_found_items_admin_update
on public.lost_found_items
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- A claimant sees their own claims; report owners can see claims for reports they
-- own (including pending reports); admins can inspect all claims.
create policy lost_found_claims_select_participant_or_admin
on public.lost_found_claims
for select
to authenticated
using (
  claimant_id = (select auth.uid())
  or exists (
    select 1
    from public.lost_found_items as item
    where item.id = lost_found_claims.item_id
      and item.owner_id = (select auth.uid())
  )
  or (select public.is_admin())
);

-- Claims are permitted only for an active user, on an approved report they do
-- not own, and must be created for themselves in the pending state.
create policy lost_found_claims_insert_active_non_owner
on public.lost_found_claims
for insert
to authenticated
with check (
  claimant_id = (select auth.uid())
  and status = 'pending'
  and (select public.can_post())
  and exists (
    select 1
    from public.lost_found_items as item
    where item.id = lost_found_claims.item_id
      and item.status = 'approved'
      and item.owner_id <> (select auth.uid())
  )
);

-- Only admins can update claim status or any other claim field. No student
-- update or delete policy is defined, so claims remain immutable to students.
create policy lost_found_claims_admin_update
on public.lost_found_claims
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Create a private bucket so image bytes require an authenticated Storage request.
-- Item visibility remains governed by table RLS; applications should issue signed
-- URLs after checking access to the corresponding report. The dashboard limit is
-- 3 MiB (3 * 1024 * 1024 bytes) and accepts only the listed image formats.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lost-found',
  'lost-found',
  false,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Remove prior versions of these named Storage policies on migration reruns.
drop policy if exists lost_found_upload_own_folder on storage.objects;
drop policy if exists lost_found_admin_delete on storage.objects;

-- Signed-in users can upload only when the first folder in the object path is
-- their own Auth user ID (for example: <user-uuid>/photo.webp).
create policy lost_found_upload_own_folder
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'lost-found'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- Admins may delete objects from this bucket. No update, read, or student delete
-- policy is created here; the bucket remains private by default.
create policy lost_found_admin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'lost-found'
  and (select public.is_admin())
);

commit;
