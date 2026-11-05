-- =====================================================================
-- Train Well — staff shift scheduling (November 2026)
--  * shifts: one row per shift at a home, for an employee or left open
--  * shift_trades: the tradeboard (offer -> pick up -> manager approves)
-- Rules enforced here, not just in the page:
--  * Admins and managers add, change and delete shifts at any home.
--  * Employees see their own home's schedule (with colleagues' names)
--    and can't change it. They can offer their own future shifts and
--    pick up a colleague's offered shift at the same home.
--  * A trade only moves the shift when a manager or admin approves it.
--  * Nobody can be double-booked.
-- Run after update-2026-10-all-homes.sql. Safe to run more than once.
-- =====================================================================

create table if not exists public.shifts (
  id           bigint generated always as identity primary key,
  facility_id  bigint not null references public.facilities(id) on delete cascade,
  employee_id  bigint references public.employees(id) on delete set null,   -- null = open shift
  position     text,
  notes        text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint shifts_length check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours')
);
create index if not exists shifts_fac_time_idx on public.shifts (facility_id, starts_at);
create index if not exists shifts_emp_time_idx on public.shifts (employee_id, starts_at);

create table if not exists public.shift_trades (
  id            bigint generated always as identity primary key,
  shift_id      bigint not null references public.shifts(id) on delete cascade,
  facility_id   bigint not null references public.facilities(id) on delete cascade,
  offered_by    bigint references public.employees(id) on delete set null,
  offered_at    timestamptz not null default now(),
  note          text,
  status        text not null default 'offered' check (status in ('offered','pending','approved','declined','cancelled')),
  picked_up_by  bigint references public.employees(id) on delete set null,
  picked_at     timestamptz,
  decided_by    uuid references public.profiles(id) on delete set null,
  decided_at    timestamptz
);
create unique index if not exists shift_trades_one_open on public.shift_trades (shift_id) where status in ('offered','pending');
create index if not exists shift_trades_fac_idx on public.shift_trades (facility_id, offered_at desc);

-- ---------- No double-booking; changing who works a shift closes its open trade ----------
create or replace function public.shift_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null and exists (
       select 1 from public.shifts s
       where s.employee_id = new.employee_id and s.id is distinct from new.id
         and s.starts_at < new.ends_at and s.ends_at > new.starts_at) then
    raise exception 'This person already has a shift that overlaps this time.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  elsif new.employee_id is distinct from old.employee_id and not coalesce(current_setting('trainwell.trade_move', true), '') = 'on' then
    update public.shift_trades set status = 'cancelled', decided_at = now()
    where shift_id = new.id and status in ('offered','pending');
  end if;
  return new;
end $$;
drop trigger if exists trg_shift_guard on public.shifts;
create trigger trg_shift_guard before insert or update on public.shifts
  for each row execute function public.shift_guard();

-- ---------- Security rules ----------
alter table public.shifts enable row level security;
alter table public.shift_trades enable row level security;

drop policy if exists shifts_staff_all on public.shifts;
create policy shifts_staff_all on public.shifts for all
  using (public.can_access_facility(facility_id)) with check (public.can_access_facility(facility_id));
drop policy if exists shifts_emp_read on public.shifts;
create policy shifts_emp_read on public.shifts for select
  using (facility_id = public.my_employee_facility() or employee_id = public.my_employee_id());

drop policy if exists trades_staff_read on public.shift_trades;
create policy trades_staff_read on public.shift_trades for select using (public.can_access_facility(facility_id));
drop policy if exists trades_emp_read on public.shift_trades;
create policy trades_emp_read on public.shift_trades for select using (facility_id = public.my_employee_facility());

grant select, insert, update, delete on public.shifts to authenticated;
grant select on public.shift_trades to authenticated;
revoke insert, update, delete on public.shift_trades from authenticated;

-- ---------- Who can be scheduled (names only). Employees get just their own home. ----------
create or replace function public.schedule_staff(p_facility bigint default null)
returns table (id bigint, full_name text, facility_id bigint, job_title text)
language sql stable security definer set search_path = public as $$
  select e.id, e.first_name || ' ' || e.last_name, e.facility_id, e.job_title
  from public.employees e
  where e.status = 'active'
    and (p_facility is null or e.facility_id = p_facility)
    and (public.is_staff() or (public.my_employee_id() is not null and e.facility_id = public.my_employee_facility()))
  order by e.first_name, e.last_name;
$$;

-- ---------- Tradeboard actions ----------
create or replace function public.offer_shift(p_shift_id bigint, p_note text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.shifts; me bigint := public.my_employee_id();
begin
  select * into s from public.shifts where id = p_shift_id;
  if s.id is null or me is null or s.employee_id is distinct from me then raise exception 'You can only offer your own shifts.'; end if;
  if s.starts_at <= now() then raise exception 'This shift has already started.'; end if;
  if exists (select 1 from public.shift_trades where shift_id = s.id and status in ('offered','pending')) then
    raise exception 'This shift is already on the tradeboard.'; end if;
  insert into public.shift_trades (shift_id, facility_id, offered_by, note)
  values (s.id, s.facility_id, me, nullif(trim(coalesce(p_note, '')), ''));
end $$;

create or replace function public.cancel_trade(p_trade_id bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
declare x public.shift_trades;
begin
  select * into x from public.shift_trades where id = p_trade_id;
  if x.id is null or (x.offered_by is distinct from public.my_employee_id() and not public.can_access_facility(x.facility_id)) then
    raise exception 'You can only withdraw your own offers.'; end if;
  if x.status not in ('offered','pending') then raise exception 'This trade is already closed.'; end if;
  update public.shift_trades set status = 'cancelled', decided_at = now() where id = x.id;
end $$;

create or replace function public.pick_up_shift(p_trade_id bigint)
returns void language plpgsql volatile security definer set search_path = public as $$
declare x public.shift_trades; s public.shifts; me bigint := public.my_employee_id();
begin
  select * into x from public.shift_trades where id = p_trade_id;
  if x.id is null or x.status <> 'offered' then raise exception 'This shift is no longer available.'; end if;
  if me is null then raise exception 'Only staff with a schedule can pick up shifts.'; end if;
  if x.offered_by = me then raise exception 'You can''t pick up your own shift.'; end if;
  if x.facility_id is distinct from public.my_employee_facility() then raise exception 'You can only pick up shifts at your own home.'; end if;
  select * into s from public.shifts where id = x.shift_id;
  if s.starts_at <= now() then raise exception 'This shift has already started.'; end if;
  if exists (select 1 from public.shifts o where o.employee_id = me and o.id <> s.id
             and o.starts_at < s.ends_at and o.ends_at > s.starts_at) then
    raise exception 'You''re already working during this shift.'; end if;
  update public.shift_trades set status = 'pending', picked_up_by = me, picked_at = now() where id = x.id;
end $$;

create or replace function public.decide_trade(p_trade_id bigint, p_approve boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare x public.shift_trades;
begin
  select * into x from public.shift_trades where id = p_trade_id;
  if x.id is null or not public.can_access_facility(x.facility_id) then
    raise exception 'Only a manager or admin can approve trades.'; end if;
  if x.status <> 'pending' then raise exception 'This trade isn''t waiting for approval.'; end if;
  if p_approve then
    perform set_config('trainwell.trade_move', 'on', true);
    update public.shifts set employee_id = x.picked_up_by where id = x.shift_id;   -- the guard checks for clashes
    perform set_config('trainwell.trade_move', 'off', true);
  end if;
  update public.shift_trades set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now() where id = x.id;
end $$;

revoke all on function public.schedule_staff(bigint) from public;
revoke all on function public.offer_shift(bigint, text) from public;
revoke all on function public.cancel_trade(bigint) from public;
revoke all on function public.pick_up_shift(bigint) from public;
revoke all on function public.decide_trade(bigint, boolean) from public;
grant execute on function public.schedule_staff(bigint) to authenticated;
grant execute on function public.offer_shift(bigint, text) to authenticated;
grant execute on function public.cancel_trade(bigint) to authenticated;
grant execute on function public.pick_up_shift(bigint) to authenticated;
grant execute on function public.decide_trade(bigint, boolean) to authenticated;
