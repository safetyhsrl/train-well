-- =====================================================================
-- Train Well update: online courses and quizzes   (safe to run more than once)
-- Run in Supabase: SQL Editor -> New query -> paste -> Run
--
--  * course_materials : links, PDFs, videos and PowerPoints for each course
--  * quiz_questions   : multiple-choice questions (answers are never sent to employees)
--  * quiz_attempts    : every quiz an employee submits, with the score
--  * material_views   : which materials an employee has opened
--  * submit_quiz()    : marks the quiz on the server; a pass records the training
--  * Private storage bucket "course-materials" for uploaded files
-- =====================================================================

alter table public.courses add column if not exists pass_mark integer not null default 80;
alter table public.courses drop constraint if exists courses_pass_mark_check;
alter table public.courses add constraint courses_pass_mark_check check (pass_mark between 1 and 100);

create table if not exists public.course_materials (
  id          bigint generated always as identity primary key,
  course_id   bigint not null references public.courses(id) on delete cascade,
  title       text not null,
  kind        text not null check (kind in ('link','pdf','video','ppt','file')),
  url         text,                 -- web link, YouTube/Vimeo link
  file_path   text,                 -- file in the "course-materials" bucket
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  check (url is not null or file_path is not null)
);
create index if not exists course_materials_course_idx on public.course_materials(course_id, sort);

create table if not exists public.quiz_questions (
  id          bigint generated always as identity primary key,
  course_id   bigint not null references public.courses(id) on delete cascade,
  sort        integer not null default 0,
  question    text not null,
  options     jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  correct     integer not null check (correct >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists quiz_questions_course_idx on public.quiz_questions(course_id, sort);

create table if not exists public.quiz_attempts (
  id             bigint generated always as identity primary key,
  course_id      bigint not null references public.courses(id) on delete cascade,
  employee_id    bigint not null references public.employees(id) on delete cascade,
  score          numeric(5,1) not null,
  correct        integer not null,
  total          integer not null,
  passed         boolean not null,
  answers        jsonb,
  completion_id  bigint references public.completions(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists quiz_attempts_emp_idx on public.quiz_attempts(employee_id, course_id);
create index if not exists quiz_attempts_course_idx on public.quiz_attempts(course_id, created_at desc);

create table if not exists public.material_views (
  employee_id  bigint not null references public.employees(id) on delete cascade,
  material_id  bigint not null references public.course_materials(id) on delete cascade,
  viewed_at    timestamptz not null default now(),
  primary key (employee_id, material_id)
);

-- ---------- Security rules ----------
alter table public.course_materials enable row level security;
alter table public.quiz_questions   enable row level security;
alter table public.quiz_attempts    enable row level security;
alter table public.material_views   enable row level security;

drop policy if exists mat_read on public.course_materials;
create policy mat_read on public.course_materials for select using (public.is_active_user());
drop policy if exists mat_admin on public.course_materials;
create policy mat_admin on public.course_materials for all using (public.is_admin()) with check (public.is_admin());

-- Questions and answers: admins and managers only. Employees get questions through get_quiz(), without answers.
drop policy if exists quiz_q_staff_read on public.quiz_questions;
create policy quiz_q_staff_read on public.quiz_questions for select using (public.is_staff());
drop policy if exists quiz_q_admin on public.quiz_questions;
create policy quiz_q_admin on public.quiz_questions for all using (public.is_admin()) with check (public.is_admin());

-- Attempts are only ever created by submit_quiz()
drop policy if exists quiz_att_read on public.quiz_attempts;
create policy quiz_att_read on public.quiz_attempts for select using (
  employee_id = public.my_employee_id()
  or exists (select 1 from public.employees e where e.id = employee_id and public.can_access_facility(e.facility_id)));
drop policy if exists quiz_att_admin_delete on public.quiz_attempts;
create policy quiz_att_admin_delete on public.quiz_attempts for delete using (public.is_admin());

drop policy if exists mview_read on public.material_views;
create policy mview_read on public.material_views for select using (
  employee_id = public.my_employee_id()
  or exists (select 1 from public.employees e where e.id = employee_id and public.can_access_facility(e.facility_id)));
drop policy if exists mview_self_insert on public.material_views;
create policy mview_self_insert on public.material_views for insert with check (employee_id = public.my_employee_id());

grant select, insert, update, delete on public.course_materials, public.quiz_questions to authenticated;
grant select, delete on public.quiz_attempts to authenticated;
grant select, insert on public.material_views to authenticated;

-- ---------- Quiz for the person taking it (no answers included) ----------
create or replace function public.get_quiz(p_course bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'Not signed in.'; end if;
  return jsonb_build_object(
    'pass_mark', (select pass_mark from public.courses where id = p_course),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'options', q.options) order by q.sort, q.id)
                           from public.quiz_questions q where q.course_id = p_course), '[]'::jsonb));
end $$;

-- ---------- Mark a quiz. p_answers = {"<question id>": <chosen option index>, ...} ----------
create or replace function public.submit_quiz(p_course bigint, p_answers jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_emp bigint := public.my_employee_id();
  v_pass integer; v_title text;
  v_total integer := 0; v_right integer := 0; v_score numeric(5,1); v_passed boolean;
  v_results jsonb := '[]'::jsonb; v_completion bigint; q record; v_choice integer;
begin
  if not public.is_active_user() then raise exception 'Not signed in.'; end if;
  select pass_mark, title into v_pass, v_title from public.courses where id = p_course;
  if v_pass is null then raise exception 'Course not found.'; end if;

  if v_emp is not null and exists (
       select 1 from public.course_materials m where m.course_id = p_course
       and not exists (select 1 from public.material_views v where v.material_id = m.id and v.employee_id = v_emp)) then
    raise exception 'Open all the course materials before taking the quiz.';
  end if;

  for q in select * from public.quiz_questions where course_id = p_course order by sort, id loop
    v_total := v_total + 1;
    v_choice := case when jsonb_typeof(p_answers -> q.id::text) = 'number' then (p_answers ->> q.id::text)::integer end;
    if v_choice = q.correct then v_right := v_right + 1; end if;
    v_results := v_results || jsonb_build_object('id', q.id, 'chosen', v_choice, 'is_correct', v_choice is not distinct from q.correct, 'correct', q.correct);
  end loop;
  if v_total = 0 then raise exception 'This course has no quiz yet.'; end if;

  v_score  := round(100.0 * v_right / v_total, 1);
  v_passed := v_score >= v_pass;
  -- Only show the right answers once the quiz is passed
  if not v_passed then
    select coalesce(jsonb_agg(r - 'correct'), '[]'::jsonb) into v_results from jsonb_array_elements(v_results) r;
  end if;

  if v_emp is null then   -- an admin or manager trying the quiz: nothing is saved
    return jsonb_build_object('preview', true, 'score', v_score, 'correct', v_right, 'total', v_total,
                              'passed', v_passed, 'pass_mark', v_pass, 'results', v_results);
  end if;

  if v_passed then
    insert into public.completions (employee_id, course_id, completed_on, score, notes, recorded_by)
    values (v_emp, p_course, (now() at time zone 'America/St_Johns')::date, v_score,
            'Passed the online course quiz (' || v_score || '%)', auth.uid())
    returning id into v_completion;
  end if;

  insert into public.quiz_attempts (course_id, employee_id, score, correct, total, passed, answers, completion_id)
  values (p_course, v_emp, v_score, v_right, v_total, v_passed, p_answers, v_completion);

  return jsonb_build_object('score', v_score, 'correct', v_right, 'total', v_total, 'passed', v_passed,
                            'pass_mark', v_pass, 'results', v_results,
                            'expires_on', (select expires_on from public.completions where id = v_completion));
end $$;

-- ---------- Number of quiz questions per course (for the course list) ----------
create or replace function public.quiz_counts()
returns table (course_id bigint, questions integer) language sql stable security definer set search_path = public as $$
  select q.course_id, count(*)::integer from public.quiz_questions q where public.is_active_user() group by q.course_id;
$$;

revoke all on function public.quiz_counts() from public;
grant execute on function public.quiz_counts() to authenticated;
revoke all on function public.get_quiz(bigint) from public;
revoke all on function public.submit_quiz(bigint, jsonb) from public;
grant execute on function public.get_quiz(bigint) to authenticated;
grant execute on function public.submit_quiz(bigint, jsonb) to authenticated;

-- ---------- Course files (private bucket) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-materials', 'course-materials', false, 52428800,
        array['application/pdf','video/mp4','video/webm','video/quicktime',
              'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'image/jpeg','image/png'])
on conflict (id) do nothing;

drop policy if exists course_files_read on storage.objects;
create policy course_files_read on storage.objects for select to authenticated
  using (bucket_id = 'course-materials' and public.is_active_user());
drop policy if exists course_files_admin on storage.objects;
create policy course_files_admin on storage.objects for all to authenticated
  using (bucket_id = 'course-materials' and public.is_admin())
  with check (bucket_id = 'course-materials' and public.is_admin());

-- Check: should list 4 tables
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('course_materials','quiz_questions','quiz_attempts','material_views') order by 1;
