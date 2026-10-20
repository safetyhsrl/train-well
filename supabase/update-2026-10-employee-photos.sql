-- =====================================================================
-- Train Well update: employee photos            (safe to run more than once)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
--
--  * employees.photo_path  points at the employee's photo
--  * A private storage bucket "employee-photos" holds the files,
--    stored as  <employee id>/<file name>
--  * Admins and managers (own facility) can add, change and remove photos.
--    An employee with a login can see their own photo.
-- =====================================================================

alter table public.employees add column if not exists photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('employee-photos', 'employee-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists photo_staff_all on storage.objects;
create policy photo_staff_all on storage.objects for all to authenticated
  using (bucket_id = 'employee-photos' and exists (
          select 1 from public.employees e
          where e.id::text = (storage.foldername(name))[1] and public.can_access_facility(e.facility_id)))
  with check (bucket_id = 'employee-photos' and exists (
          select 1 from public.employees e
          where e.id::text = (storage.foldername(name))[1] and public.can_access_facility(e.facility_id)));

drop policy if exists photo_self_read on storage.objects;
create policy photo_self_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-photos' and (storage.foldername(name))[1] = public.my_employee_id()::text);

-- Check: should list 2 policies
select policyname from pg_policies where tablename = 'objects' and policyname like 'photo_%';
