-- Migration 365: lesson feedback from students.
--
-- Why: the principal, 5 Oct 2026: students tap a lesson they have had on their
-- timetable and answer a few yes/no questions, plus green / amber / red for how
-- well they understood it. The principal's decisions:
--   * Feedback can be given from the end of the lesson until the end of the
--     next day, once per lesson, and not by a student marked absent.
--   * Teaching lessons only: not Mentor, Prep, Personal Study or The Other
--     Half (homework_is_teaching_subject(), plus the Oh / Sa codes).
--   * Teachers never see names. They (and Heads of Department for their
--     department) see a summary only, through lesson_feedback_summary(), and
--     only for a class with at least 3 responses in the dates chosen, so a
--     single student's answers can't be picked out.
--   * Only SMT see named responses (has_staff_role, so admin alone is not
--     enough), so somebody can follow up a student who asked for help.
--   * Parents see nothing. No free-text comment box.
--
-- The questions are data (lesson_feedback_questions), edited on /admin/lookups.
-- good_answer says which answer is the good one ("Were you bored?" -> no), or
-- null for a question that isn't good or bad ("Would you like extra help?").
-- Once a question has answers its wording can't be changed (it would change
-- what the old answers mean): retire it and add a new one instead. Questions
-- are retired, never deleted.
--
-- Students write only through give_lesson_feedback(), which checks every rule
-- above. The feedback tables have select policies only.

set local formwork.change_note = 'Principal (direct)';

-- ---- Questions --------------------------------------------------------------

create table public.lesson_feedback_questions (
  question_id serial primary key,
  position integer not null default 0,
  question text not null check (btrim(question) <> '' and length(question) <= 120),
  good_answer boolean,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.lesson_feedback_questions enable row level security;
grant select, insert, update on public.lesson_feedback_questions to authenticated;
grant usage on sequence public.lesson_feedback_questions_question_id_seq to authenticated;

create policy lesson_feedback_questions_read on public.lesson_feedback_questions
  for select to authenticated using (true);
create policy lesson_feedback_questions_add on public.lesson_feedback_questions
  for insert to authenticated with check ((select has_resource_access('/admin/lookups')));
create policy lesson_feedback_questions_edit on public.lesson_feedback_questions
  for update to authenticated
  using ((select has_resource_access('/admin/lookups')))
  with check ((select has_resource_access('/admin/lookups')));

insert into public.lesson_feedback_questions (position, question, good_answer) values
  (1,  'Did the lesson start on time?', true),
  (2,  'Did you know what you were meant to learn by the end of the lesson?', true),
  (3,  'Was the pace of the lesson about right?', true),
  (4,  'Was the lesson too easy for you?', false),
  (5,  'Was the lesson too hard for you?', false),
  (6,  'Were you bored in the lesson?', false),
  (7,  'Could you explain today''s main idea to a friend?', true),
  (8,  'Did you get help when you needed it?', true),
  (9,  'Was the classroom calm enough to concentrate?', true),
  (10, 'Would you like extra help with this topic?', null);

-- ---- Feedback ---------------------------------------------------------------

create table public.lesson_feedback (
  feedback_id bigserial primary key,
  student_id integer not null references public.students(student_id),
  -- The Nova-T import deletes and re-creates a class's lessons, so the link to
  -- the lesson goes empty then; class, date and period still say which it was.
  slot_id integer references public.timetable_slots(slot_id) on delete set null,
  lesson_date date not null,
  period_number integer not null,
  class_id integer not null references public.classes(class_id),
  subject_id integer not null references public.subjects(subject_id),
  staff_id integer references public.staff(staff_id),
  year_group integer,
  understanding text not null check (understanding in ('green', 'amber', 'red')),
  created_at timestamptz not null default now()
);

create unique index lesson_feedback_once on public.lesson_feedback (student_id, class_id, lesson_date, period_number);
create index lesson_feedback_staff_date on public.lesson_feedback (staff_id, lesson_date);
create index lesson_feedback_class_date on public.lesson_feedback (class_id, lesson_date);

create table public.lesson_feedback_answers (
  answer_id bigserial primary key,
  feedback_id bigint not null references public.lesson_feedback(feedback_id) on delete cascade,
  question_id integer not null references public.lesson_feedback_questions(question_id),
  answer boolean not null
);

create unique index lesson_feedback_answers_once on public.lesson_feedback_answers (feedback_id, question_id);
create index lesson_feedback_answers_question on public.lesson_feedback_answers (question_id);

alter table public.lesson_feedback enable row level security;
alter table public.lesson_feedback_answers enable row level security;
grant select on public.lesson_feedback to authenticated;
grant select on public.lesson_feedback_answers to authenticated;

-- A student sees their own (so the timetable can show "feedback given").
create policy lesson_feedback_student_read on public.lesson_feedback
  for select to authenticated using (student_id = (select my_student_id()));
create policy lesson_feedback_answers_student_read on public.lesson_feedback_answers
  for select to authenticated using (exists (
    select 1 from lesson_feedback f
    where f.feedback_id = lesson_feedback_answers.feedback_id
      and f.student_id = (select my_student_id())));

-- SMT see named responses. Nobody else reads the rows.
create policy lesson_feedback_smt_read on public.lesson_feedback
  for select to authenticated using ((select has_staff_role(array['smt'])));
create policy lesson_feedback_answers_smt_read on public.lesson_feedback_answers
  for select to authenticated using ((select has_staff_role(array['smt'])));

-- A question's wording is fixed once it has answers.
create or replace function public.lesson_feedback_question_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if (new.question is distinct from old.question or new.good_answer is distinct from old.good_answer)
     and exists (select 1 from lesson_feedback_answers a where a.question_id = old.question_id) then
    raise exception 'Students have already answered this question, so its wording can''t change. Retire it and add a new one.';
  end if;
  new.question := btrim(new.question);
  return new;
end;
$$;

revoke execute on function public.lesson_feedback_question_guard() from public, anon, authenticated;

create trigger trg_lesson_feedback_question_guard
  before update on public.lesson_feedback_questions
  for each row execute function public.lesson_feedback_question_guard();

-- ---- Which lessons a student can give feedback on ---------------------------

-- The open lessons for the signed-in student: today's and yesterday's teaching
-- lessons that have ended, in term, not on a holiday, in a class they had
-- joined, where they weren't marked absent. given = already done.
create or replace function public.my_lesson_feedback_lessons()
returns table (slot_id integer, lesson_date date, class_id integer, subject_name text,
               period_number integer, start_time time, end_time time, given boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with me as (select my_student_id() as student_id),
  days as (
    select d::date as day
    from generate_series(school_today() - 1, school_today(), interval '1 day') d
    where exists (select 1 from terms t where d::date between t.start_date and t.end_date)
      and not exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = d::date)
  )
  select ts.slot_id, days.day, c.class_id,
         coalesce(sub.display_name, sub.subject_name),
         ts.period_number, ts.start_time, ts.end_time,
         exists (select 1 from lesson_feedback f
                 where f.student_id = me.student_id and f.class_id = c.class_id
                   and f.lesson_date = days.day and f.period_number = ts.period_number)
  from me
  join student_class sc on sc.student_id = me.student_id
  join classes c on c.class_id = sc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  join timetable_slots ts on ts.class_id = c.class_id
  join days on to_char(days.day, 'Dy') = ts.day_of_week
  where homework_is_teaching_subject(c.subject_id)
    and coalesce(sub.subject_code, '') not in ('Oh', 'Sa')
    and coalesce(sc.joined_on, days.day) <= days.day
    and (days.day + ts.end_time) <= school_now()
    and not exists (
      select 1 from attendance a
      where a.student_id = me.student_id and a.attend_date = days.day
        and a.period_number = ts.period_number
        and a.status in ('absent', 'authorized_absence'))
  order by days.day, ts.period_number;
$$;

revoke execute on function public.my_lesson_feedback_lessons() from public, anon;
grant execute on function public.my_lesson_feedback_lessons() to authenticated;

-- p_answers: {"<question_id>": true/false, ...}, one for every active question.
create or replace function public.give_lesson_feedback(
  p_slot_id integer, p_lesson_date date, p_understanding text, p_answers jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer := my_student_id();
  v_lesson record;
  v_class classes%rowtype;
  v_year integer;
  v_id bigint;
  v_q record;
  v_key text;
begin
  if v_student is null then
    raise exception 'Only students can give lesson feedback.';
  end if;

  select * into v_lesson from my_lesson_feedback_lessons() l
  where l.slot_id = p_slot_id and l.lesson_date = p_lesson_date;
  if not found then
    raise exception 'Feedback for that lesson isn''t open. You can give it from the end of the lesson until the end of the next day.';
  end if;
  if v_lesson.given then
    raise exception 'You have already given feedback on this lesson.';
  end if;

  if p_understanding is null or p_understanding not in ('green', 'amber', 'red') then
    raise exception 'Please choose green, amber or red for how well you understood the lesson.';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Please answer every question.';
  end if;
  for v_q in select question_id from lesson_feedback_questions where active loop
    if jsonb_typeof(p_answers -> v_q.question_id::text) is distinct from 'boolean' then
      raise exception 'Please answer every question.';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_answers) loop
    if not exists (select 1 from lesson_feedback_questions
                   where active and question_id::text = v_key) then
      raise exception 'Unknown question in the feedback.';
    end if;
  end loop;

  select * into v_class from classes where class_id = v_lesson.class_id;
  select year_group into v_year from students where student_id = v_student;

  insert into lesson_feedback (student_id, slot_id, lesson_date, period_number, class_id, subject_id, staff_id, year_group, understanding)
  select v_student, ts.slot_id, p_lesson_date, ts.period_number, v_class.class_id, v_class.subject_id,
         coalesce(ts.staff_id, v_class.staff_id), v_year, p_understanding
  from timetable_slots ts where ts.slot_id = p_slot_id
  returning feedback_id into v_id;

  insert into lesson_feedback_answers (feedback_id, question_id, answer)
  select v_id, q.question_id, (p_answers ->> q.question_id::text)::boolean
  from lesson_feedback_questions q where q.active;

  return v_id;
exception when unique_violation then
  raise exception 'You have already given feedback on this lesson.';
end;
$$;

revoke execute on function public.give_lesson_feedback(integer, date, text, jsonb) from public, anon;
grant execute on function public.give_lesson_feedback(integer, date, text, jsonb) to authenticated;

-- ---- Summary for staff (no names) -------------------------------------------

-- One row per class in the dates chosen, for the classes the caller may see:
-- the lessons they taught; their department's as Head of Department; every
-- class for SMT. A class with fewer than 3 responses comes back with its
-- count only, and every other figure null.
-- questions: [{question_id, question, good_answer, yes, no}] in question order.
create or replace function public.lesson_feedback_summary(p_from date, p_to date)
returns table (class_id integer, class_code text, subject_name text, year_group integer,
               teacher_name text, staff_id integer, responses integer,
               green integer, amber integer, red integer, questions jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_staff integer;
  v_smt boolean := has_staff_role(array['smt']);
  v_dept text;
begin
  select p.staff_id into v_staff from profiles p where p.id = auth.uid();
  if v_staff is null and not v_smt then
    return;
  end if;
  select sr.scope_value into v_dept
  from staff_roles sr
  where sr.staff_id = v_staff and sr.role_name = 'head_of_department' and sr.scope_type = 'department'
  limit 1;

  return query
  with mine as (
    select f.*
    from lesson_feedback f
    join subjects sub on sub.subject_id = f.subject_id
    where f.lesson_date between p_from and p_to
      and (v_smt or f.staff_id = v_staff or (v_dept is not null and sub.department_name = v_dept))
  ),
  per_class as (
    select m.class_id, m.staff_id, count(*)::integer as responses,
           count(*) filter (where m.understanding = 'green')::integer as green,
           count(*) filter (where m.understanding = 'amber')::integer as amber,
           count(*) filter (where m.understanding = 'red')::integer as red
    from mine m
    group by m.class_id, m.staff_id
  ),
  per_question as (
    select m.class_id, m.staff_id,
           jsonb_agg(jsonb_build_object(
             'question_id', q.question_id, 'question', q.question, 'good_answer', q.good_answer,
             'yes', q.yes, 'no', q.no) order by q.position, q.question_id) as questions
    from (select distinct class_id, staff_id from mine) m
    cross join lateral (
      select lq.question_id, lq.question, lq.good_answer, lq.position,
             count(*) filter (where a.answer)::integer as yes,
             count(*) filter (where not a.answer)::integer as no
      from mine m2
      join lesson_feedback_answers a on a.feedback_id = m2.feedback_id
      join lesson_feedback_questions lq on lq.question_id = a.question_id
      where m2.class_id = m.class_id and m2.staff_id is not distinct from m.staff_id
      group by lq.question_id, lq.question, lq.good_answer, lq.position
    ) q
    group by m.class_id, m.staff_id
  )
  select pc.class_id, c.class_code, coalesce(sub.display_name, sub.subject_name), c.year_group,
         case when s.staff_id is null then null else s.first_name || ' ' || s.last_name end,
         pc.staff_id, pc.responses,
         case when pc.responses >= 3 then pc.green end,
         case when pc.responses >= 3 then pc.amber end,
         case when pc.responses >= 3 then pc.red end,
         case when pc.responses >= 3 then pq.questions end
  from per_class pc
  join classes c on c.class_id = pc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  left join staff s on s.staff_id = pc.staff_id
  left join per_question pq on pq.class_id = pc.class_id and pq.staff_id is not distinct from pc.staff_id
  order by c.year_group, c.class_code, 5;
end;
$$;

revoke execute on function public.lesson_feedback_summary(date, date) from public, anon;
grant execute on function public.lesson_feedback_summary(date, date) to authenticated;

-- ---- The staff page ---------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/lesson-feedback', 'Lesson Feedback', 'Students', 18)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('teacher', '/lesson-feedback'),
  ('head_of_department', '/lesson-feedback'),
  ('smt', '/lesson-feedback')
on conflict do nothing;
