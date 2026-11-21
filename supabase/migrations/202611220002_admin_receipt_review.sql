-- Allow verified admins to read private user-files objects (e.g. payment receipts).
-- This adds read-only access; it does not make the bucket public or grant writes.
drop policy if exists user_files_admin_read on storage.objects;
create policy user_files_admin_read on storage.objects
  for select to authenticated
  using (bucket_id='user-files' and public.is_admin());
