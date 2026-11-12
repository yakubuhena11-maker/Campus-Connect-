// Run in the Supabase SQL Editor as project owner. Safe to re-run.
begin;

-- Reconcile bucket settings even if an earlier migration was only partly applied.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lost-found', 'lost-found', false, 3145728, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Uploads must be stored below the authenticated user's UUID folder.
drop policy if exists lost_found_upload_own_folder on storage.objects;
create policy lost_found_upload_own_folder
on storage.objects for insert to authenticated
with check (
  bucket_id = 'lost-found'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- The bucket is private, but any signed-in user can read report photos.
drop policy if exists lost_found_authenticated_read on storage.objects;
create policy lost_found_authenticated_read
on storage.objects for select to authenticated
using (bucket_id = 'lost-found');

commit;
