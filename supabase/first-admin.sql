-- =====================================================================
-- Make your first administrator (run once, after schema.sql)
--
-- 1. Supabase dashboard -> Authentication -> Users -> "Add user"
--    -> "Create new user". Enter your email + a password and tick
--    "Auto Confirm User".
-- 2. Change the email and name below, then run this in the SQL Editor.
-- After that, add every other manager from the Users page in the app.
-- =====================================================================

insert into public.profiles (id, full_name, email, role, facility_id, active)
select id, 'Your Name', email, 'admin', null, true
from auth.users
where email = 'you@yourcompany.com'
on conflict (id) do update set role = 'admin', active = true;
