-- =====================================================================
-- Train Well — security update (October 2026)
--  * Admins and managers must finish two-step sign-in (an authenticator
--    app code) before the database lets them see or change anything.
--  * Admins can see which admins/managers have two-step sign-in on, and
--    reset it for someone who lost their phone.
--  * Every sign-in is recorded on the server (who, when, device, IP) and
--    admins can see the last 12 months of it.
-- Safe to run more than once.
-- =====================================================================

-- ---------- Two-step sign-in ----------
-- True when this login finished two-step sign-in (Supabase puts "aal2" in the login token).
create or replace function public.mfa_ok()
returns boolean language sql stable set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_staff()       -- admin or manager (not employee)
returns boolean language sql stable security definer set search_path = public as $$
  select public.mfa_ok() and exists (select 1 from public.profiles
                 where id = auth.uid() and active and role in ('admin','manager'));
$$;

-- Which admins/managers have two-step sign-in turned on (admins only)
create or replace function public.mfa_status()
returns table (user_id uuid, since timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select f.user_id, min(f.created_at) from auth.mfa_factors f
  where public.is_admin() and f.status = 'verified'
  group by f.user_id;
$$;

-- Remove someone's authenticator so they can set it up again (admins only, not yourself)
create or replace function public.reset_mfa(p_user uuid)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only administrators can reset two-step sign-in.'; end if;
  if p_user = auth.uid() then raise exception 'Ask another administrator to reset your own two-step sign-in.'; end if;
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;          -- signs them out everywhere
  insert into public.sign_ins (user_id, event, detail)
  values (p_user, 'mfa_reset', 'Reset by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'an administrator'));
end $$;

-- ---------- Sign-in history ----------
create table if not exists public.sign_ins (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  at          timestamptz not null default now(),
  event       text not null,          -- signed_in | two_step | mfa_reset
  ip          text,
  user_agent  text,
  detail      text
);
create index if not exists sign_ins_at_idx on public.sign_ins (at desc);
create index if not exists sign_ins_user_idx on public.sign_ins (user_id, at desc);

alter table public.sign_ins enable row level security;
drop policy if exists sign_ins_admin_read on public.sign_ins;
create policy sign_ins_admin_read on public.sign_ins for select using (public.is_admin());
revoke all on public.sign_ins from anon, authenticated;
grant select on public.sign_ins to authenticated;

-- Recorded by the database itself when Supabase creates or upgrades a login session,
-- so it can't be skipped or faked from the browser. Never blocks a sign-in.
create or replace function public.log_sign_in()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.sign_ins (user_id, event, ip, user_agent)
      values (new.user_id, 'signed_in', host(new.ip), left(new.user_agent, 400));
      delete from public.sign_ins where at < now() - interval '13 months';
    elsif new.aal = 'aal2' and old.aal is distinct from 'aal2' then
      insert into public.sign_ins (user_id, event, ip, user_agent)
      values (new.user_id, 'two_step', host(new.ip), left(new.user_agent, 400));
    end if;
  exception when others then
    null;   -- never stop someone signing in because the log failed
  end;
  return new;
end $$;

drop trigger if exists trw_log_sign_in on auth.sessions;
create trigger trw_log_sign_in
  after insert or update of aal on auth.sessions
  for each row execute function public.log_sign_in();

-- Sign-in history with names (admins only)
create or replace function public.sign_in_history(p_days integer default 30)
returns table (at timestamptz, event text, full_name text, email text, role text, ip text, user_agent text, detail text)
language sql stable security definer set search_path = public as $$
  select s.at, s.event, p.full_name, coalesce(p.email, u.email), p.role, s.ip, s.user_agent, s.detail
  from public.sign_ins s
  left join public.profiles p on p.id = s.user_id
  left join auth.users u on u.id = s.user_id
  where public.is_admin() and s.at >= now() - make_interval(days => greatest(1, least(p_days, 400)))
  order by s.at desc
  limit 2000;
$$;

revoke all on function public.mfa_status() from public;
revoke all on function public.reset_mfa(uuid) from public;
revoke all on function public.sign_in_history(integer) from public;
revoke all on function public.log_sign_in() from public;
grant execute on function public.log_sign_in() to supabase_auth_admin;
grant execute on function public.mfa_status() to authenticated;
grant execute on function public.reset_mfa(uuid) to authenticated;
grant execute on function public.sign_in_history(integer) to authenticated;
