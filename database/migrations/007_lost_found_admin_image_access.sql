-- Allow admins to create temporary signed URLs for moderation photos in the
-- private lost-found bucket. The bucket remains private to everyone else.
begin;

drop policy if exists lost_found_admin_read on storage.objects;

create policy lost_found_admin_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'lost-found'
  and (select public.is_admin())
);

comment on policy lost_found_admin_read on storage.objects is
  'Allows admins to read lost-and-found photos for moderation; the bucket remains private to non-admin users.';

commit;
