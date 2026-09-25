-- Migration 174: which subjects each week's assessment covered, for the
-- Termly Grade Report.
--
-- Why: not every subject is assessed every week. Week 1 of the September
-- Term 2026 was English, Maths and Science for Years 7-9, and English, Maths
-- and the pathway subjects for Years 10-12. On the report a blank square
-- could mean "not assessed that week" or "the mark was never entered", and
-- staff couldn't tell which. The report now lists every subject the student
-- takes and shades the first kind light grey, so a white blank in an
-- assessed week means a mark is outstanding.
--
-- Whether a subject was assessed in a week is taken from the data: it was
-- if anyone in the student's year group has a result for it that week.
-- The report is downloaded by students and parents as well as staff, and
-- their RLS on results only reaches their own child's rows, so this is a
-- SECURITY DEFINER function. It returns only subject/week pairs for the
-- year group (no marks, no names) plus the student's own subjects, and
-- only to a caller who could already read this student's results under
-- the results policies.
--
-- Rows come back in two kinds:
--   week_start_date set  — the year group was assessed in subject_id that
--                           week; `enrolled` says whether the student takes it
--   week_start_date null — a subject the student takes (from student_class),
--                           so it gets a row on the report even before any
--                           mark lands in it
--
-- Tutor/study slots are timetabled as classes too (Mentor, Prep,
-- Registration…) but are never graded, so subjects gets an
-- on_grade_report flag and those are switched off here. Set it to false
-- for any new non-graded subject.

alter table public.subjects
  add column if not exists on_grade_report boolean not null default true;

update public.subjects
   set on_grade_report = false
 where subject_name in ('Mentor', 'Mentor Group', 'Prep', 'Report/Prep', 'Personal Study', 'Registration', 'Other Half');

create or replace function public.report_week_assessments(p_student_id integer, p_from date, p_to date)
returns table (subject_id integer, week_start_date date, enrolled boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (
    is_staff_or_admin()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.student_id = p_student_id)
    or exists (
      select 1 from profiles p join student_parent sp on sp.parent_id = p.parent_id
      where p.id = auth.uid() and sp.student_id = p_student_id
    )
  ) then
    raise exception 'Not allowed to view this student''s report' using errcode = 'insufficient_privilege';
  end if;

  return query
  select distinct r.subject_id, r.week_start_date,
         exists (
           select 1 from student_class sc join classes c on c.class_id = sc.class_id
           where sc.student_id = p_student_id and c.subject_id = r.subject_id
         ) as enrolled
  from results r
  join students s on s.student_id = r.student_id
  where s.year_group = (select year_group from students where student_id = p_student_id)
    and r.week_start_date between p_from and p_to
    and not r.is_demo
  union
  select distinct c.subject_id, null::date, true
  from student_class sc
  join classes c on c.class_id = sc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  where sc.student_id = p_student_id
    and sub.on_grade_report;
end;
$$;

revoke execute on function public.report_week_assessments(integer, date, date) from public, anon;
grant execute on function public.report_week_assessments(integer, date, date) to authenticated;
