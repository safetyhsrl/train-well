-- =====================================================================
-- Train Well update: fire drill scheduling      (safe to run more than once)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
--
-- Fire drills planned for the future. When the drill happens and its
-- report is recorded, drill_id links the schedule to that report.
-- Admins see every home; managers only their own.
-- =====================================================================

create table if not exists public.fire_drill_schedule (
  id              bigint generated always as identity primary key,
  facility_id     bigint not null references public.facilities(id) on delete cascade,
  scheduled_date  date not null,
  scheduled_time  time,
  activity        text check (activity in ('staff_only','full','info_session')),
  coordinator     text,
  notes           text,
  drill_id        bigint references public.fire_drills(id) on delete set null,  -- set once recorded
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists fire_drill_schedule_idx on public.fire_drill_schedule(facility_id, scheduled_date);

alter table public.fire_drill_schedule enable row level security;

drop policy if exists drill_sched_rw on public.fire_drill_schedule;
create policy drill_sched_rw on public.fire_drill_schedule for all
  using (public.can_access_facility(facility_id))
  with check (public.can_access_facility(facility_id));

grant select, insert, update, delete on public.fire_drill_schedule to authenticated;

-- Check: should return 1 row
select policyname from pg_policies where tablename = 'fire_drill_schedule';
