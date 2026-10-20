-- =====================================================================
-- Train Well — Fire Drilling (October 2026)
-- Adds fire drill reports, based on the Fire Drill Report form.
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run more than once.
-- =====================================================================

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

grant select, insert, update, delete on public.fire_drills, public.fire_drill_participants to authenticated;
