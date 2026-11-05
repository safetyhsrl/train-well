-- =====================================================================
-- Train Well — faster scheduling (November 2026)
--  * add_shifts: add many shifts at once (skips anyone already working)
--  * copy_shifts: copy a week's shifts forward 1-12 weeks
-- Both run with the caller's own permissions, so only admins and
-- managers can use them. Run after update-2026-11-schedule.sql.
-- Safe to run more than once.
-- =====================================================================
create or replace function public.add_shifts(p_rows jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare r jsonb; added int := 0; skipped int := 0;
begin
  if not public.is_staff() then raise exception 'Only managers and admins can change the schedule.'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Add at most 2,000 shifts at a time.'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      if nullif(r->>'employee_id', '') is null and exists (
           select 1 from public.shifts s where s.employee_id is null
             and s.facility_id = (r->>'facility_id')::bigint and s.starts_at = (r->>'starts_at')::timestamptz) then
        skipped := skipped + 1; continue;
      end if;
      insert into public.shifts (facility_id, employee_id, position, notes, starts_at, ends_at)
      values ((r->>'facility_id')::bigint, nullif(r->>'employee_id', '')::bigint, nullif(r->>'position', ''),
              nullif(r->>'notes', ''), (r->>'starts_at')::timestamptz, (r->>'ends_at')::timestamptz);
      added := added + 1;
    exception when others then
      skipped := skipped + 1;     -- already working then, or not allowed
    end;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- Copies shifts that start in [p_from, p_to) forward by whole weeks, keeping the
-- same local (Newfoundland) clock times across daylight-saving changes.
create or replace function public.copy_shifts(p_from timestamptz, p_to timestamptz, p_weeks integer,
                                              p_facility bigint default null, p_include_open boolean default true)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare s record; k int; ns timestamptz; ne timestamptz; added int := 0; skipped int := 0;
begin
  if not public.is_staff() then raise exception 'Only managers and admins can change the schedule.'; end if;
  if p_weeks < 1 or p_weeks > 12 then raise exception 'Copy 1 to 12 weeks at a time.'; end if;
  for k in 1..p_weeks loop
    for s in select * from public.shifts
             where starts_at >= p_from and starts_at < p_to
               and (p_facility is null or facility_id = p_facility)
               and (p_include_open or employee_id is not null) loop
      ns := ((s.starts_at at time zone 'America/St_Johns') + make_interval(days => 7 * k)) at time zone 'America/St_Johns';
      ne := ((s.ends_at   at time zone 'America/St_Johns') + make_interval(days => 7 * k)) at time zone 'America/St_Johns';
      if exists (select 1 from public.shifts x where x.facility_id = s.facility_id and x.starts_at = ns
                 and x.employee_id is not distinct from s.employee_id) then
        skipped := skipped + 1; continue;        -- already copied
      end if;
      begin
        insert into public.shifts (facility_id, employee_id, position, notes, starts_at, ends_at)
        values (s.facility_id, s.employee_id, s.position, s.notes, ns, ne);
        added := added + 1;
      exception when others then
        skipped := skipped + 1;                  -- that person is already working then
      end;
    end loop;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

revoke all on function public.add_shifts(jsonb) from public;
revoke all on function public.copy_shifts(timestamptz, timestamptz, integer, bigint, boolean) from public;
grant execute on function public.add_shifts(jsonb) to authenticated;
grant execute on function public.copy_shifts(timestamptz, timestamptz, integer, bigint, boolean) to authenticated;
