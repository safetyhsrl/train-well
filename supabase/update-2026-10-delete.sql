-- =====================================================================
-- Train Well — update for the Delete buttons (October 2026)
-- Run ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Lets a manager/admin login be deleted even if that person scheduled
-- sessions or recorded training: those sessions and records are kept,
-- they just no longer show who entered them.
-- Safe to run more than once.
-- =====================================================================

alter table public.sessions    drop constraint if exists sessions_created_by_fkey;
alter table public.sessions    add  constraint sessions_created_by_fkey
  foreign key (created_by)  references public.profiles(id) on delete set null;

alter table public.completions drop constraint if exists completions_recorded_by_fkey;
alter table public.completions add  constraint completions_recorded_by_fkey
  foreign key (recorded_by) references public.profiles(id) on delete set null;
