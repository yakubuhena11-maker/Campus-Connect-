-- Notifications for targeted student updates and administrator announcements.
-- Run in the Supabase SQL Editor as the project owner. This migration is
-- repeatable: named policies and triggers are replaced when re-run.

begin;

-- A notification with a NULL user_id is a broadcast visible to every signed-in
-- student. Event notifications always target one profile. Links are optional
-- relative page paths; absolute URLs and root-relative paths are rejected.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  title text not null,
  message text not null,
  type text not null check (type in ('announcement', 'lost_found', 'voice', 'account')),
  link text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint notifications_link_relative check (
    link is null or (link <> '' and link !~ '^(//|/|[A-Za-z][A-Za-z0-9+.-]*:)')
  )
);
comment on table public.notifications is
  'Student notifications. A NULL user_id represents a broadcast to all signed-in students.';
comment on column public.notifications.user_id is
  'Target profile; NULL means the notification is broadcast to all students.';
comment on column public.notifications.type is
  'Notification category: announcement, lost_found, voice, or account.';
comment on column public.notifications.link is
  'Optional relative page path for the notification destination; external/root-relative URLs are not accepted.';
comment on column public.notifications.created_by is
  'Profile that created a broadcast or notification directly; NULL for automated events or after profile deletion.';

-- A per-user receipt row records that user’s read time. This also applies to
-- broadcasts: each student has an independent (notification_id, user_id) row.
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
comment on table public.notification_reads is
  'Per-user read receipts, including independent read state for broadcast notifications.';
comment on column public.notification_reads.read_at is
  'Time the current user marked the notification as read.';

create index if not exists notifications_user_created_at_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notification_reads_user_notification_idx
  on public.notification_reads (user_id, notification_id);

-- RLS is the boundary for all client access. Only authenticated users receive
-- table privileges; notification inserts are further restricted to admins.
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
revoke all on table public.notifications, public.notification_reads from public, anon, authenticated;
grant select, insert on table public.notifications to authenticated;
grant select, insert on table public.notification_reads to authenticated;

drop policy if exists notifications_select_recipient_or_broadcast on public.notifications;
drop policy if exists notifications_insert_admin on public.notifications;
drop policy if exists notification_reads_select_self on public.notification_reads;
drop policy if exists notification_reads_insert_self on public.notification_reads;

-- A student can read their own notification rows and broadcasts, but not another
-- student's targeted notification. Broadcasts are visible to signed-in admins too.
create policy notifications_select_recipient_or_broadcast
on public.notifications
for select
to authenticated
using (user_id is null or user_id = (select auth.uid()));

-- Direct inserts are for admin-created announcements/notifications only. Setting
-- created_by to auth.uid() prevents an admin from attributing a direct insert to
-- another profile. Trigger functions insert automated events as their owner.
create policy notifications_insert_admin
on public.notifications
for insert
to authenticated
with check (
  (select public.is_admin())
  and created_by = (select auth.uid())
);

-- Read receipts are private to the signed-in user. There are deliberately no
-- update or delete policies; clients insert a receipt once per notification.
create policy notification_reads_select_self
on public.notification_reads
for select
to authenticated
using (user_id = (select auth.uid()));

create policy notification_reads_insert_self
on public.notification_reads
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.notifications as notification
    where notification.id = notification_id
      and (notification.user_id is null or notification.user_id = (select auth.uid()))
  )
);

-- Return the number of unread targeted and broadcast notifications for the
-- caller. As an invoker function, this obeys the notification RLS policies.
create or replace function public.notification_unread_count()
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*)
  from public.notifications as notification
  where (notification.user_id is null or notification.user_id = (select auth.uid()))
    and not exists (
      select 1
      from public.notification_reads as receipt
      where receipt.notification_id = notification.id
        and receipt.user_id = (select auth.uid())
    );
$$;
comment on function public.notification_unread_count() is
  'Returns the unread notification count for the current authenticated user, including broadcasts.';
revoke all on function public.notification_unread_count() from public, anon;
grant execute on function public.notification_unread_count() to authenticated;

-- SECURITY DEFINER trigger functions write only to notifications and use a fixed,
-- empty search_path. Automated notifications do not include another student's
-- identity; voice notices target the actual author_id even for anonymous posts.
create or replace function public.notify_lost_found_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications (user_id, title, message, type, link, created_by)
    values (
      new.owner_id,
      'Lost and Found update',
      'The status of your ' || new.type || ' report “' || new.title || '” changed to ' || replace(new.status, '_', ' ') || '.',
      'lost_found',
      'lost-found.html',
      null
    );
  end if;
  return new;
end;
$$;
comment on function public.notify_lost_found_status_change() is
  'Notifies a report owner when their lost_found_items status changes.';

drop trigger if exists notifications_lost_found_status_change on public.lost_found_items;
create trigger notifications_lost_found_status_change
after update of status on public.lost_found_items
for each row execute function public.notify_lost_found_status_change();

create or replace function public.notify_lost_found_claim_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_owner_id uuid;
  item_title text;
begin
  select item.owner_id, item.title
    into item_owner_id, item_title
    from public.lost_found_items as item
    where item.id = new.item_id;

  if item_owner_id is not null then
    -- Deliberately omit claimant identity and claim message from the owner notice.
    insert into public.notifications (user_id, title, message, type, link, created_by)
    values (
      item_owner_id,
      'New Lost and Found claim',
      'A student submitted a claim for your item “' || item_title || '”.',
      'lost_found',
      'lost-found.html',
      null
    );
  end if;
  return new;
end;
$$;
comment on function public.notify_lost_found_claim_created() is
  'Notifies the item owner when a claim is created without disclosing claimant identity.';

drop trigger if exists notifications_lost_found_claim_created on public.lost_found_claims;
create trigger notifications_lost_found_claim_created
after insert on public.lost_found_claims
for each row execute function public.notify_lost_found_claim_created();

create or replace function public.notify_lost_found_claim_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_title text;
begin
  if new.status is distinct from old.status then
    select item.title into item_title
      from public.lost_found_items as item
      where item.id = new.item_id;
    insert into public.notifications (user_id, title, message, type, link, created_by)
    values (
      new.claimant_id,
      'Claim status update',
      'Your claim for “' || coalesce(item_title, 'a campus item') || '” changed to ' || replace(new.status, '_', ' ') || '.',
      'lost_found',
      'lost-found.html',
      null
    );
  end if;
  return new;
end;
$$;
comment on function public.notify_lost_found_claim_status_change() is
  'Notifies the claimant when their own lost_found_claims status changes.';

drop trigger if exists notifications_lost_found_claim_status_change on public.lost_found_claims;
create trigger notifications_lost_found_claim_status_change
after update of status on public.lost_found_claims
for each row execute function public.notify_lost_found_claim_status_change();

create or replace function public.notify_voice_post_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    -- This private notification goes only to author_id. Do not copy the author
    -- identity into any public text, including when is_anonymous is true.
    insert into public.notifications (user_id, title, message, type, link, created_by)
    values (
      new.author_id,
      'Student Voice update',
      'The status of your Student Voice post “' || new.title || '” changed to ' || replace(new.status, '_', ' ') || '.',
      'voice',
      'voice-post.html?id=' || new.id::text,
      null
    );
  end if;
  return new;
end;
$$;
comment on function public.notify_voice_post_status_change() is
  'Notifies a Student Voice post author about status changes without exposing anonymous authorship.';

drop trigger if exists notifications_voice_post_status_change on public.voice_posts;
create trigger notifications_voice_post_status_change
after update of status on public.voice_posts
for each row execute function public.notify_voice_post_status_change();

create or replace function public.notify_voice_admin_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  post_author_id uuid;
  post_title text;
begin
  -- Do not notify on non-admin replies, even if policies change in the future.
  if (select public.is_admin()) then
    select post.author_id, post.title
      into post_author_id, post_title
      from public.voice_posts as post
      where post.id = new.post_id;

    if post_author_id is not null then
      -- The recipient is the author only. No author name or anonymous identity is
      -- included in a notification visible to another student.
      insert into public.notifications (user_id, title, message, type, link, created_by)
      values (
        post_author_id,
        'A reply to your Student Voice post',
        'An administrator replied to your post “' || post_title || '”.',
        'voice',
        'voice-post.html?id=' || new.post_id::text,
        null
      );
    end if;
  end if;
  return new;
end;
$$;
comment on function public.notify_voice_admin_reply() is
  'Notifies only the author when an administrator replies to their Student Voice post.';

drop trigger if exists notifications_voice_admin_reply on public.voice_replies;
create trigger notifications_voice_admin_reply
after insert on public.voice_replies
for each row execute function public.notify_voice_admin_reply();

-- Supabase Realtime uses the supabase_realtime publication. Add the table only
-- when the publication exists and the table is not already a member, so reruns
-- remain safe. Realtime changes are still subject to the table's RLS policies.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

commit;
