-- =====================================================================
-- Train Well — managers work across all homes (October 2026)
-- Admins and managers can now see and update every home's employees,
-- training records, sessions and fire drills. Only admins can still
-- manage users, homes (facilities) and courses. Employees are unchanged:
-- they only see their own records.
-- Safe to run more than once.
-- =====================================================================
create or replace function public.can_access_facility(f bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and f is not null;
$$;

-- Fix the spelling of Morgan's Community Care Home
update public.facilities set name = 'Morgan''s Community Care Home'
where name = 'Morgans Communtiy Care Home';
