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
  created_by   uuid references public.profiles(id),
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
  completed_on  date not null,
  expires_on    date,                 -- auto-filled from course validity if left blank
  score         numeric(5,2),
  certificate_no text,
  notes         text,
  recorded_by   uuid references public.profiles(id),
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
order by c.employee_id, c.course_id, c.completed_on desc;

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
