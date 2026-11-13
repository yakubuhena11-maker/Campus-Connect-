-- 009_voice_visibility.sql
-- Adds public/private visibility to Student Voice posts.
-- Existing posts become public. Safe to run more than once.

begin;

alter table public.voice_posts
  add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'private'));

comment on column public.voice_posts.visibility is
  'public: visible to all signed-in students. private: visible only to the author and admins.';

-- Students may choose visibility only when creating a post. They have no
-- update policy, so it cannot be changed afterwards.
grant select (id, category, title, message, is_anonymous, status, is_hidden, created_at, visibility)
  on public.voice_posts to authenticated;
grant insert (author_id, category, title, message, is_anonymous, status, is_hidden, visibility)
  on public.voice_posts to authenticated;

-- Helper: can the current user see this post? (security definer, so it works
-- without exposing author_id to students)
create or replace function public.can_view_voice_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.voice_posts as post
    where post.id = p_post_id
      and (
        (post.is_hidden = false and post.visibility = 'public')
        or post.author_id = (select auth.uid())
        or (select public.is_admin())
      )
  );
$$;

-- Helper: is this post public and not hidden? (used for voting)
create or replace function public.is_public_voice_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.voice_posts as post
    where post.id = p_post_id
      and post.is_hidden = false
      and post.visibility = 'public'
  );
$$;

revoke all on function public.can_view_voice_post(uuid) from public, anon;
revoke all on function public.is_public_voice_post(uuid) from public, anon;
grant execute on function public.can_view_voice_post(uuid) to authenticated;
grant execute on function public.is_public_voice_post(uuid) to authenticated;

-- Community feed: public, non-hidden posts only.
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
where post.is_hidden = false
  and post.visibility = 'public';
grant select on public.voice_posts_public to authenticated;

-- The author's own posts, now including visibility.
create or replace view public.voice_posts_mine
with (security_barrier = true)
as
select post.id, post.category, post.title, post.message, post.is_anonymous,
       post.status, post.is_hidden, post.created_at, post.visibility
from public.voice_posts as post
where post.author_id = (select auth.uid());
grant select on public.voice_posts_mine to authenticated;

-- Admin view, now including visibility.
create or replace view public.voice_posts_admin
with (security_barrier = true)
as
select post.id, post.author_id, post.category, post.title, post.message,
       post.is_anonymous, post.status, post.is_hidden, post.created_at,
       post.visibility
from public.voice_posts as post
where (select public.is_admin());
grant select on public.voice_posts_admin to authenticated;

-- Timeline, replies and votes follow the post's visibility.
drop policy if exists voice_history_select_visible on public.voice_status_history;
create policy voice_history_select_visible
on public.voice_status_history
for select
to authenticated
using ((select public.can_view_voice_post(post_id)));

drop policy if exists voice_replies_select_visible on public.voice_replies;
create policy voice_replies_select_visible
on public.voice_replies
for select
to authenticated
using ((select public.can_view_voice_post(post_id)));

drop policy if exists voice_votes_select_visible on public.voice_votes;
create policy voice_votes_select_visible
on public.voice_votes
for select
to authenticated
using (
  (select public.can_view_voice_post(post_id))
  and (user_id = (select auth.uid()) or (select public.is_admin()))
);

drop policy if exists voice_votes_insert_active_self on public.voice_votes;
create policy voice_votes_insert_active_self
on public.voice_votes
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.can_post())
  and (select public.is_public_voice_post(post_id))
);

drop policy if exists voice_votes_delete_active_self on public.voice_votes;
create policy voice_votes_delete_active_self
on public.voice_votes
for delete
to authenticated
using (
  user_id = (select auth.uid())
  and (select public.can_post())
  and (select public.is_public_voice_post(post_id))
);

commit;

notify pgrst, 'reload schema';