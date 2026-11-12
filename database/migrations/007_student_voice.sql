-- Student Voice schema and access controls.
-- Run this migration from the Supabase SQL Editor as the project owner.

begin;

-- -----------------------------------------------------------------------------
-- Student Voice posts
-- A post belongs to its author. Students may submit received posts, but only
-- administrators can moderate visibility or change a post's workflow status.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('complaint', 'problem', 'suggestion')),
  title text not null,
  message text not null,
  is_anonymous boolean not null default false,
  status text not null default 'received'
    check (status in ('received', 'reviewing', 'resolved')),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.voice_posts is
  'Student Voice submissions; author identity is withheld from students by the public view and column privileges.';
comment on column public.voice_posts.is_anonymous is
  'When true, the author name is omitted from the student-facing public view.';
comment on column public.voice_posts.status is
  'Administrative workflow state; only admins can change it.';
comment on column public.voice_posts.is_hidden is
  'When true, the post is omitted from the public view; only admins can change it.';

-- -----------------------------------------------------------------------------
-- Status history
-- This append-style record is populated by a trigger on post creation and each
-- status change, preserving the actor and optional moderation note.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_status_history (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.voice_posts (id) on delete cascade,
  status text not null check (status in ('received', 'reviewing', 'resolved')),
  changed_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
comment on table public.voice_status_history is
  'Status timeline for Student Voice posts; entries are generated automatically by a database trigger.';
comment on column public.voice_status_history.changed_by is
  'Authenticated profile that created the post or changed its status; NULL if that profile is later deleted.';

-- -----------------------------------------------------------------------------
-- Replies
-- Replies are attached to a post and attributed to their author. RLS below
-- permits only administrators to insert; logged-in users can read replies only
-- when the associated post is visible to them.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.voice_posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);
comment on table public.voice_replies is
  'Administrative responses to Student Voice posts; visible to signed-in users only when the post is visible.';

-- -----------------------------------------------------------------------------
-- Votes
-- The composite primary key guarantees at most one upvote per user per post.
-- Students can add or remove their own vote only on a visible post and only
-- while their profile is active.
-- -----------------------------------------------------------------------------
create table if not exists public.voice_votes (
  post_id uuid not null references public.voice_posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
comment on table public.voice_votes is
  'One upvote per profile per Student Voice post.';

-- Trigger function records the initial status and subsequent status transitions.
-- SECURITY DEFINER allows the trigger to append history without granting users
-- direct insert access to the history table. Fixed search_path protects name lookup.
create or replace function public.record_voice_post_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.voice_status_history (post_id, status, changed_by, note)
    values (
      new.id,
      new.status,
      (select auth.uid()),
      case when tg_op = 'INSERT' then 'Post created' else 'Status changed' end
    );
  end if;
  return new;
end;
$$;
comment on function public.record_voice_post_status() is
  'Writes the initial voice status and every status transition to voice_status_history.';

drop trigger if exists voice_posts_record_status on public.voice_posts;
create trigger voice_posts_record_status
after insert or update of status on public.voice_posts
for each row execute function public.record_voice_post_status();

-- -----------------------------------------------------------------------------
-- Student-facing public view
-- Students read community posts through this view rather than selecting author_id
-- from the base table. Only non-hidden posts are exposed. The author name is NULL
-- for anonymous submissions, and the vote total is calculated for each post.
-- The default owner-rights view enables the controlled projection without giving
-- students base-table access to author_id.
-- -----------------------------------------------------------------------------
create or replace view public.voice_posts_public
with (security_barrier = true)
as
select
  post.id,
  post.category,
  post.title,
  post.message,
  post.status,
  post.created_at,
  (
    select count(*)::integer
    from public.voice_votes as vote
    where vote.post_id = post.id
  ) as upvote_count,
  case when post.is_anonymous then null else profile.full_name end as author_full_name
from public.voice_posts as post
left join public.profiles as profile on profile.id = post.author_id
where post.is_hidden = false;
comment on view public.voice_posts_public is
  'Student-facing feed of non-hidden posts with an upvote count and author name omitted for anonymous submissions.';
grant select on public.voice_posts_public to authenticated;

-- Private authoring view provides a student their own posts, but excludes the
-- author_id column. It is intentionally constrained to the current auth.uid().
create or replace view public.voice_posts_mine
with (security_barrier = true)
as
select post.id, post.category, post.title, post.message, post.is_anonymous,
       post.status, post.is_hidden, post.created_at
from public.voice_posts as post
where post.author_id = (select auth.uid());
comment on view public.voice_posts_mine is
  'Current user’s own Student Voice posts without exposing author_id.';
grant select on public.voice_posts_mine to authenticated;

-- Full administrative read view includes hidden posts and author IDs. Its
-- predicate ensures the owner-rights view returns no data to non-admin callers.
create or replace view public.voice_posts_admin
with (security_barrier = true)
as
select post.id, post.author_id, post.category, post.title, post.message,
       post.is_anonymous, post.status, post.is_hidden, post.created_at
from public.voice_posts as post
where (select public.is_admin());
comment on view public.voice_posts_admin is
  'Admin-only complete Student Voice post listing, including author IDs and hidden posts.';
grant select on public.voice_posts_admin to authenticated;

-- Enable RLS on every table; views above provide the intended read projections.
alter table public.voice_posts enable row level security;
alter table public.voice_status_history enable row level security;
alter table public.voice_replies enable row level security;
alter table public.voice_votes enable row level security;

-- Give authenticated clients only the base-table privileges needed by the RLS
-- rules. In particular author_id is deliberately omitted from voice_posts SELECT
-- grants, so direct queries for that column are denied by PostgreSQL privileges.
revoke all on table public.voice_posts, public.voice_status_history,
  public.voice_replies, public.voice_votes from public, anon, authenticated;
grant select (id, category, title, message, is_anonymous, status, is_hidden, created_at)
  on public.voice_posts to authenticated;
grant insert (author_id, category, title, message, is_anonymous, status, is_hidden)
  on public.voice_posts to authenticated;
grant update on public.voice_posts to authenticated;
grant select, update on public.voice_status_history to authenticated;
grant select, insert, update on public.voice_replies to authenticated;
grant select, insert, update, delete on public.voice_votes to authenticated;

-- Remove named policies so this SQL-editor migration can be safely re-applied.
drop policy if exists voice_posts_select_own_or_admin on public.voice_posts;
drop policy if exists voice_posts_insert_active_self on public.voice_posts;
drop policy if exists voice_posts_admin_update on public.voice_posts;
drop policy if exists voice_history_select_visible on public.voice_status_history;
drop policy if exists voice_history_admin_update on public.voice_status_history;
drop policy if exists voice_replies_select_visible on public.voice_replies;
drop policy if exists voice_replies_admin_insert on public.voice_replies;
drop policy if exists voice_replies_admin_update on public.voice_replies;
drop policy if exists voice_votes_select_visible on public.voice_votes;
drop policy if exists voice_votes_insert_active_self on public.voice_votes;
drop policy if exists voice_votes_delete_active_self on public.voice_votes;
drop policy if exists voice_votes_admin_update on public.voice_votes;

-- Students may read their own rows from the base table (excluding author_id via
-- column privileges); admins may read all base-table columns except author_id,
-- which is available to them through voice_posts_admin.
create policy voice_posts_select_own_or_admin
on public.voice_posts
for select
to authenticated
using (
  author_id = (select auth.uid())
  or (select public.is_admin())
);

-- New posts must be authored by the caller, active, received, and not hidden.
-- This prevents students from self-moderating posts at creation time.
create policy voice_posts_insert_active_self
on public.voice_posts
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and status = 'received'
  and is_hidden = false
  and (select public.can_post())
);

-- Students have no update policy: they cannot edit status, visibility, or other
-- fields. Administrators may update every post field and row.
create policy voice_posts_admin_update
on public.voice_posts
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Signed-in users can read history only for non-hidden posts. Admins can also
-- read history for hidden posts, and may update history entries if needed.
create policy voice_history_select_visible
on public.voice_status_history
for select
to authenticated
using (
  exists (
    select 1 from public.voice_posts as post
    where post.id = voice_status_history.post_id
      and (post.is_hidden = false or (select public.is_admin()))
  )
);
create policy voice_history_admin_update
on public.voice_status_history
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Replies are readable by authenticated users for visible posts. Admins can read
-- replies for hidden posts and are the only role allowed to insert or update them.
create policy voice_replies_select_visible
on public.voice_replies
for select
to authenticated
using (
  exists (
    select 1 from public.voice_posts as post
    where post.id = voice_replies.post_id
      and (post.is_hidden = false or (select public.is_admin()))
  )
);
create policy voice_replies_admin_insert
on public.voice_replies
for insert
to authenticated
with check (
  (select public.is_admin())
  and author_id = (select auth.uid())
);
create policy voice_replies_admin_update
on public.voice_replies
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- Votes may be read for visible posts (admins may inspect hidden-post votes).
-- Active authenticated users may upvote a visible post once and remove only
-- their own vote; the composite key enforces one vote per user/post pair.
create policy voice_votes_select_visible
on public.voice_votes
for select
to authenticated
using (
  exists (
    select 1 from public.voice_posts as post
    where post.id = voice_votes.post_id
      and (post.is_hidden = false or (select public.is_admin()))
  )
  and (user_id = (select auth.uid()) or (select public.is_admin()))
);
create policy voice_votes_insert_active_self
on public.voice_votes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.can_post())
  and exists (
    select 1 from public.voice_posts as post
    where post.id = voice_votes.post_id
      and post.is_hidden = false
  )
);
create policy voice_votes_delete_active_self
on public.voice_votes
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_post())
  and exists (
    select 1 from public.voice_posts as post
    where post.id = voice_votes.post_id
      and post.is_hidden = false
  )
);
-- Administrators may update any vote record; students cannot update votes.
create policy voice_votes_admin_update
on public.voice_votes
for update
to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

commit;
