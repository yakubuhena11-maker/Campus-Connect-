-- Campus Connect notifications, status alerts, and admin announcements.
-- Run after the core schema and Lost & Found / Student Voice migrations.

alter table public.notifications
  alter column user_id drop not null;

alter table public.notifications
  add column if not exists title text not null default 'Notification',
  add column if not exists message text not null default '',
  add column if not exists type text not null default 'system';

-- Keep legacy installations (which used `body`) readable and allow old clients
-- to coexist while the frontend migrates to `message`.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'body'
  ) then
    execute 'update public.notifications set message = body where message = '''' and body is not null';
  end if;
end;
$$;

create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_broadcast_created_idx
  on public.notifications (created_at desc) where user_id is null;

-- A broadcast is one shared notification row, so read state must be per-recipient
-- and cannot live on that shared row. This receipt table stores each user's read time.
create table if not exists public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

revoke all on public.notifications, public.notification_reads from anon;
grant select, insert, update on public.notifications to authenticated;
grant select, insert on public.notification_reads to authenticated;

-- Remove legacy policies: permissive PostgreSQL policies combine with OR, so old
-- rules must not accidentally grant wider access than the policies below.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('notifications', 'notification_reads')
  loop
    execute format('drop policy %I on %I.%I', policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end;
$$;

-- Authenticated users can see their direct notifications and all broadcast rows.
create policy notifications_select_recipient_or_broadcast
on public.notifications for select to authenticated
using (user_id = (select auth.uid()) or user_id is null);

-- Only an active admin can create a broadcast. Status-change alerts are inserted
-- by SECURITY DEFINER triggers and cannot be forged by browser clients.
create policy notifications_admin_broadcast_insert
on public.notifications for insert to authenticated
with check ((select public.is_admin()) and user_id is null);

-- Direct notification recipients may only set read_at. The trigger below blocks
-- changing message, recipient, type, title, or creation time.
create policy notifications_update_own_read_state
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy notification_reads_select_self
on public.notification_reads for select to authenticated
using (user_id = (select auth.uid()));

create policy notification_reads_insert_self_broadcast
on public.notification_reads for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.notifications n
    where n.id = notification_id and n.user_id is null
  )
);

create or replace function public.protect_notification_read_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.title is distinct from old.title
     or new.message is distinct from old.message
     or new.type is distinct from old.type
     or new.created_at is distinct from old.created_at then
    raise exception 'Notification content and recipient are immutable.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_protect_content on public.notifications;
create trigger notifications_protect_content
before update on public.notifications
for each row execute function public.protect_notification_read_update();

-- Send the author a direct notification when an item's moderation/lifecycle state changes.
create or replace function public.notify_lost_found_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications (user_id, title, message, type)
    values (
      new.user_id,
      'Lost & Found status updated',
      format('Your item "%s" is now %s.', coalesce(new.title, 'item'), replace(new.status, '_', ' ')),
      'lost_found_status'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lost_found_notify_status_change on public.lost_found_items;
create trigger lost_found_notify_status_change
after update of status on public.lost_found_items
for each row execute function public.notify_lost_found_status_change();

create or replace function public.notify_student_voice_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.notifications (user_id, title, message, type)
    values (
      new.author_id,
      'Student Voice status updated',
      format('Your report "%s" is now %s.', coalesce(new.title, 'report'), replace(new.status, '_', ' ')),
      'student_voice_status'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists student_voice_notify_status_change on public.student_voice_posts;
create trigger student_voice_notify_status_change
after update of status on public.student_voice_posts
for each row execute function public.notify_student_voice_status_change();

-- Add notifications to Supabase Realtime publication when not already present.
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

comment on table public.notification_reads is 'Per-user read receipts for shared broadcast notifications.';
comment on table public.notifications is 'Private recipient alerts and shared admin announcements.';
