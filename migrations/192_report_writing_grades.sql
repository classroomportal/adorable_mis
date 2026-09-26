-- 192_report_writing_grades.sql
--
-- Report writing: teachers now see a student's grades for the year while
-- they write, and grade presentation of work and homework alongside
-- effort; mentors, houseparents and SMT see those grades and the student's
-- behaviour totals while they write pastoral comments. Three changes:
--
-- 1. report_subject_comments gets presentation_grade and homework_grade, on
--    the same four-point scale (and the same check) as effort_grade. Both
--    nullable: nothing already written needs them.
--
-- 2. report_periods becomes readable by every member of staff. Its only
--    policy was report_periods_admin (ALL, admin/smt/assessment_manager),
--    so for an ordinary teacher or mentor the Report Period dropdown on
--    /reports/write-subject-comments and /reports/write-pastoral-comments
--    was always empty and nobody else could write a comment. Writing stays
--    with that policy; this only adds reading.
--
-- 3. report_pastoral_grades() lets someone writing a pastoral comment read
--    the effort / presentation / homework grades subject teachers have
--    entered. subject_comments_select only shows a teacher their own rows
--    (or a checker/admin/SMT everything), so a mentor couldn't see the
--    grades their mentee had been given. Rather than widen that policy -
--    which would also expose every teacher's comment text to every mentor -
--    this SECURITY DEFINER function returns the three grades and nothing
--    else, and only for students the caller writes pastoral comments for:
--    their mentees (my_mentee_ids), their boarding house (my_house_scope),
--    or anyone when they're admin/SMT. Same scopes the pastoral page uses.

alter table public.report_subject_comments
  add column if not exists presentation_grade text,
  add column if not exists homework_grade text;

alter table public.report_subject_comments
  drop constraint if exists report_subject_comments_presentation_grade_check,
  add constraint report_subject_comments_presentation_grade_check
    check (presentation_grade = any (array['Excellent', 'Good', 'Satisfactory', 'Needs Improvement'])),
  drop constraint if exists report_subject_comments_homework_grade_check,
  add constraint report_subject_comments_homework_grade_check
    check (homework_grade = any (array['Excellent', 'Good', 'Satisfactory', 'Needs Improvement']));

drop policy if exists report_periods_staff_read on public.report_periods;
create policy report_periods_staff_read on public.report_periods
  for select using (is_staff_or_admin());

create or replace function public.report_pastoral_grades(p_report_period_id integer, p_student_ids integer[])
returns table (
  student_id integer,
  subject_id integer,
  subject_name text,
  effort_grade text,
  presentation_grade text,
  homework_grade text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select rsc.student_id, rsc.subject_id,
         coalesce(sub.display_name, sub.subject_name),
         rsc.effort_grade, rsc.presentation_grade, rsc.homework_grade
  from report_subject_comments rsc
  join subjects sub on sub.subject_id = rsc.subject_id
  join students s on s.student_id = rsc.student_id
  where rsc.report_period_id = p_report_period_id
    and rsc.student_id = any (p_student_ids)
    and (
      user_has_staff_role(array['admin', 'smt'])
      or rsc.student_id in (select my_mentee_ids())
      or (s.boarding_house is not null and s.boarding_house = my_house_scope())
    );
$$;

revoke all on function public.report_pastoral_grades(integer, integer[]) from public, anon;
grant execute on function public.report_pastoral_grades(integer, integer[]) to authenticated;
