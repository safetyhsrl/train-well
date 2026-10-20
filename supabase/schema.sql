-- =====================================================================
-- Train Well — database schema for Supabase (PostgreSQL)
-- Run this whole file once in Supabase: SQL Editor -> New query -> Run
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table if not exists public.facilities (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  address     text,
  created_at  timestamptz not null default now()
);

-- One row per manager/admin login (linked to Supabase Auth users)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  email        text not null,
  role         text not null default 'manager' check (role in ('admin','manager')),
  facility_id  bigint references public.facilities(id) on delete set null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.employees (
  id           bigint generated always as identity primary key,
  employee_no  text unique,
  first_name   text not null,
  last_name    text not null,
  email        text,
  phone        text,
  job_title    text,
  department   text,
  facility_id  bigint not null references public.facilities(id),
  hire_date    date,
  status       text not null default 'active' check (status in ('active','inactive')),
  photo_path   text,               -- file in the private "employee-photos" bucket
  created_at   timestamptz not null default now()
);
create index if not exists employees_facility_idx on public.employees(facility_id);

create table if not exists public.courses (
  id                bigint generated always as identity primary key,
  code              text unique,
  title             text not null,
  description       text,
  category          text,
  duration_hours    numeric(5,2),
  validity_months   integer,          -- null = never expires
  mandatory         boolean not null default false,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists public.sessions (
  id           bigint generated always as identity primary key,
  course_id    bigint not null references public.courses(id) on delete cascade,
  facility_id  bigint not null references public.facilities(id),
  starts_at    timestamptz not null,
  ends_at      timestamptz,
  location     text,
  trainer      text,
  capacity     integer,
  notes        text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists sessions_facility_idx on public.sessions(facility_id);

create table if not exists public.attendance (
  id           bigint generated always as identity primary key,
  session_id   bigint not null references public.sessions(id) on delete cascade,
  employee_id  bigint not null references public.employees(id) on delete cascade,
  status       text not null default 'registered'
               check (status in ('registered','attended','absent','excused')),
  created_at   timestamptz not null default now(),
  unique (session_id, employee_id)
);

-- Training completion records (one row per employee per completion)
create table if not exists public.completions (
  id            bigint generated always as identity primary key,
  employee_id   bigint not null references public.employees(id) on delete cascade,
  course_id     bigint not null references public.courses(id) on delete cascade,
  session_id    bigint references public.sessions(id) on delete set null,
  completed_on  date,                -- blank allowed for imported records with only an expiry date
  expires_on    date,                 -- auto-filled from course validity if left blank
  score         numeric(5,2),
  certificate_no text,
  notes         text,
  recorded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists completions_employee_idx on public.completions(employee_id);
create index if not exists completions_expiry_idx on public.completions(expires_on);

-- ---------- Auto-fill expiry date from course validity ----------------

create or replace function public.set_completion_expiry()
returns trigger language plpgsql as $$
declare v integer;
begin
  if new.expires_on is null then
    select validity_months into v from public.courses where id = new.course_id;
    if v is not null then
      new.expires_on := (new.completed_on + make_interval(months => v))::date;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_completion_expiry on public.completions;
create trigger trg_completion_expiry
  before insert or update on public.completions
  for each row execute function public.set_completion_expiry();

-- When attendance is marked "attended", record a completion automatically
create or replace function public.attendance_to_completion()
returns trigger language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if new.status = 'attended' and (tg_op = 'INSERT' or old.status is distinct from 'attended') then
    select course_id, starts_at into s from public.sessions where id = new.session_id;
    if not exists (select 1 from public.completions
                   where employee_id = new.employee_id and session_id = new.session_id) then
      insert into public.completions (employee_id, course_id, session_id, completed_on, recorded_by)
      values (new.employee_id, s.course_id, new.session_id, s.starts_at::date, auth.uid());
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_attendance_completion on public.attendance;
create trigger trg_attendance_completion
  after insert or update on public.attendance
  for each row execute function public.attendance_to_completion();

-- ---------- Helper functions used by security rules -------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.my_facility()
returns bigint language sql stable security definer set search_path = public as $$
  select facility_id from public.profiles where id = auth.uid() and active;
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

-- Can the current user see/edit this facility's data?
create or replace function public.can_access_facility(f bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_active_user() and f = public.my_facility());
$$;

-- ---------- Row Level Security ----------------------------------------
-- Admins: everything. Managers: only their own facility.

alter table public.facilities  enable row level security;
alter table public.profiles    enable row level security;
alter table public.employees   enable row level security;
alter table public.courses     enable row level security;
alter table public.sessions    enable row level security;
alter table public.attendance  enable row level security;
alter table public.completions enable row level security;

-- facilities
drop policy if exists fac_read on public.facilities;
create policy fac_read on public.facilities for select
  using (public.can_access_facility(id));
drop policy if exists fac_admin on public.facilities;
create policy fac_admin on public.facilities for all
  using (public.is_admin()) with check (public.is_admin());

-- profiles (manager accounts)
drop policy if exists prof_read on public.profiles;
create policy prof_read on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists prof_admin on public.profiles;
create policy prof_admin on public.profiles for all
  using (public.is_admin()) with check (public.is_admin());

-- employees
drop policy if exists emp_rw on public.employees;
create policy emp_rw on public.employees for all
  using (public.can_access_facility(facility_id))
  with check (public.can_access_facility(facility_id));

-- courses: every active user can read; admins manage
drop policy if exists course_read on public.courses;
create policy course_read on public.courses for select
  using (public.is_active_user());
drop policy if exists course_admin on public.courses;
create policy course_admin on public.courses for all
  using (public.is_admin()) with check (public.is_admin());

-- sessions
drop policy if exists sess_rw on public.sessions;
create policy sess_rw on public.sessions for all
  using (public.can_access_facility(facility_id))
  with check (public.can_access_facility(facility_id));

-- attendance (via the employee's facility)
drop policy if exists att_rw on public.attendance;
create policy att_rw on public.attendance for all
  using (exists (select 1 from public.employees e
                 where e.id = employee_id and public.can_access_facility(e.facility_id)))
  with check (exists (select 1 from public.employees e
                 where e.id = employee_id and public.can_access_facility(e.facility_id)));

-- completions (via the employee's facility)
drop policy if exists comp_rw on public.completions;
create policy comp_rw on public.completions for all
  using (exists (select 1 from public.employees e
                 where e.id = employee_id and public.can_access_facility(e.facility_id)))
  with check (exists (select 1 from public.employees e
                 where e.id = employee_id and public.can_access_facility(e.facility_id)));

-- ---------- Fire drills -----------------------------------------------

create table if not exists public.fire_drills (
  id                 bigint generated always as identity primary key,
  facility_id        bigint not null references public.facilities(id),   -- Name of Home
  drill_date         date not null,
  start_time         time,
  end_time           time,
  event_type         text not null default 'drill' check (event_type in ('drill','alarm')),  -- planned drill / unplanned alarm
  activity           text check (activity in ('staff_only','full','info_session')),
  -- Outcome of fire event: yes / no / na
  q_meeting_area     text check (q_meeting_area     in ('yes','no','na')),
  q_fire_doors       text check (q_fire_doors       in ('yes','no','na')),
  q_windows_doors    text check (q_windows_doors    in ('yes','no','na')),
  q_staff_response   text check (q_staff_response   in ('yes','no','na')),
  q_corridors_clear  text check (q_corridors_clear  in ('yes','no','na')),
  q_pull_stations    text check (q_pull_stations    in ('yes','no','na')),
  q_fire_dept_called text check (q_fire_dept_called in ('yes','no','na')),
  q_extinguishing    text check (q_extinguishing    in ('yes','no','na')),
  problems           text,          -- problems, concerns or actions for improvement
  coordinator        text,          -- fire drill coordinator
  observer_name      text,
  observer_date      date,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists fire_drills_facility_idx on public.fire_drills(facility_id, drill_date desc);

-- Staff who took part / signed after the debrief
create table if not exists public.fire_drill_participants (
  id           bigint generated always as identity primary key,
  drill_id     bigint not null references public.fire_drills(id) on delete cascade,
  employee_id  bigint references public.employees(id) on delete set null,
  name         text not null,       -- kept even if the employee is later deleted
  created_at   timestamptz not null default now()
);
create index if not exists fire_drill_participants_drill_idx on public.fire_drill_participants(drill_id);

-- Security: admins see all homes, managers only their own
alter table public.fire_drills             enable row level security;
alter table public.fire_drill_participants enable row level security;

drop policy if exists drill_rw on public.fire_drills;
create policy drill_rw on public.fire_drills for all
  using (public.can_access_facility(facility_id))
  with check (public.can_access_facility(facility_id));

drop policy if exists drill_part_rw on public.fire_drill_participants;
create policy drill_part_rw on public.fire_drill_participants for all
  using (exists (select 1 from public.fire_drills d
                 where d.id = drill_id and public.can_access_facility(d.facility_id)))
  with check (exists (select 1 from public.fire_drills d
                 where d.id = drill_id and public.can_access_facility(d.facility_id)));


-- ---------- Handy view: latest status per employee & course -----------

create or replace view public.training_status
with (security_invoker = true) as
select distinct on (c.employee_id, c.course_id)
  c.employee_id, c.course_id, c.completed_on, c.expires_on,
  case
    when c.expires_on is null            then 'valid'
    when c.expires_on < current_date     then 'expired'
    when c.expires_on < current_date + 30 then 'expiring'
    else 'valid'
  end as status
from public.completions c
order by c.employee_id, c.course_id, c.completed_on desc nulls last, c.expires_on desc nulls last;

-- ---------- Starter data ----------------------------------------------
-- Rename these in the app (Facilities page) or edit them here first.

insert into public.facilities (name) values
  ('Facility 1'), ('Facility 2'), ('Facility 3')
on conflict (name) do nothing;

insert into public.courses (code, title, category, duration_hours, validity_months, mandatory) values
  ('WHMIS',  'WHMIS 2015',                 'Safety',     2,  12, true),
  ('FA-CPR', 'Standard First Aid & CPR',   'Safety',    16,  36, true),
  ('FIRE',   'Fire Safety & Evacuation',   'Safety',     1,  12, true),
  ('ORIENT', 'New Employee Orientation',   'Onboarding', 4, null, true)
on conflict (code) do nothing;

-- =====================================================================
-- Employee logins + certificate uploads
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
