-- =====================================================================
-- Train Well — Employee logins + certificate uploads (October 2026)
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
--
-- What it does
--  * Adds an "employee" role. An employee login is linked to one employee record.
--  * Employees can only see THEIR OWN training, sessions and fire drills.
--  * Employees can upload certificates; the upload counts straight away.
--  * A private storage bucket "certificates" holds the files.
--  * Managers keep seeing only their own home; admins see everything.
-- =====================================================================

-- ---------- Profiles: employee role + link to the employee record ----------
alter table public.profiles add column if not exists employee_id bigint
  references public.employees(id) on delete cascade;
create unique index if not exists profiles_employee_uidx
  on public.profiles(employee_id) where employee_id is not null;
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','manager','employee'));

-- ---------- Training records: certificate file ----------
alter table public.completions add column if not exists certificate_path text;
alter table public.completions add column if not exists uploaded_by_employee boolean not null default false;

-- ---------- Helper functions ----------
create or replace function public.is_staff()       -- admin or manager (not employee)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and active and role in ('admin','manager'));
$$;

create or replace function public.my_employee_id() -- the employee record of an employee login
returns bigint language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles
  where id = auth.uid() and active and role = 'employee';
$$;

create or replace function public.my_employee_facility()
returns bigint language sql stable security definer set search_path = public as $$
  select e.facility_id from public.employees e where e.id = public.my_employee_id();
$$;

-- Sessions / fire drills an employee is on (looked up directly, so the rules don't loop)
create or replace function public.my_session_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select a.session_id from public.attendance a where a.employee_id = public.my_employee_id();
$$;

create or replace function public.my_drill_ids()
returns setof bigint language sql stable security definer set search_path = public as $$
  select p.drill_id from public.fire_drill_participants p where p.employee_id = public.my_employee_id();
$$;

-- Facility access is for admins and managers only (employees get their own rules below)
create or replace function public.can_access_facility(f bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_staff() and f = public.my_facility());
$$;

-- ---------- Employee (self-service) rules ----------
drop policy if exists emp_self_read on public.employees;
create policy emp_self_read on public.employees for select
  using (id = public.my_employee_id());

drop policy if exists fac_self_read on public.facilities;
create policy fac_self_read on public.facilities for select
  using (id = public.my_employee_facility());

drop policy if exists comp_self_read on public.completions;
create policy comp_self_read on public.completions for select
  using (employee_id = public.my_employee_id());

drop policy if exists comp_self_insert on public.completions;
create policy comp_self_insert on public.completions for insert
  with check (employee_id = public.my_employee_id() and uploaded_by_employee);

drop policy if exists comp_self_update on public.completions;
create policy comp_self_update on public.completions for update
  using (employee_id = public.my_employee_id() and uploaded_by_employee)
  with check (employee_id = public.my_employee_id() and uploaded_by_employee);

drop policy if exists comp_self_delete on public.completions;
create policy comp_self_delete on public.completions for delete
  using (employee_id = public.my_employee_id() and uploaded_by_employee);

drop policy if exists att_self_read on public.attendance;
create policy att_self_read on public.attendance for select
  using (employee_id = public.my_employee_id());

drop policy if exists sess_self_read on public.sessions;
create policy sess_self_read on public.sessions for select
  using (id in (select public.my_session_ids()));

drop policy if exists drill_part_self_read on public.fire_drill_participants;
create policy drill_part_self_read on public.fire_drill_participants for select
  using (employee_id = public.my_employee_id());

drop policy if exists drill_self_read on public.fire_drills;
create policy drill_self_read on public.fire_drills for select
  using (id in (select public.my_drill_ids()));

-- ---------- Certificate files (private bucket) ----------
-- Files are stored as  <employee id>/<file name>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificates', 'certificates', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;

drop policy if exists cert_self_all on storage.objects;
create policy cert_self_all on storage.objects for all to authenticated
  using (bucket_id = 'certificates' and (storage.foldername(name))[1] = public.my_employee_id()::text)
  with check (bucket_id = 'certificates' and (storage.foldername(name))[1] = public.my_employee_id()::text);

drop policy if exists cert_staff_all on storage.objects;
create policy cert_staff_all on storage.objects for all to authenticated
  using (bucket_id = 'certificates' and exists (
          select 1 from public.employees e
          where e.id::text = (storage.foldername(name))[1] and public.can_access_facility(e.facility_id)))
  with check (bucket_id = 'certificates' and exists (
          select 1 from public.employees e
          where e.id::text = (storage.foldername(name))[1] and public.can_access_facility(e.facility_id)));
