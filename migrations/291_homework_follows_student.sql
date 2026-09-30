-- Migration 291: homework marks follow the student, and feed reports.
--
-- Why: the principal (30 Sept 2026) raised two concerns with the homework
-- design. Marks were tied to the class they were set in, so a student who
-- changed class or teacher left their marks behind with the old teacher; and
-- homework was kept out of reporting altogether, so the marks couldn't inform
-- the end-of-term report. The principal's decisions:
--
--   * Marks follow the student. Whoever teaches the student in a subject now
--     can read all of that student's homework marks in that subject for the
--     current school year, from any class. The teacher who set the homework
--     still sees the marks they gave; the Head of Department, SMT and admins
--     see everything, as before.
--   * Reports use them. homework_report_summary() gives, per student and
--     subject, the average of the term's number-marked homework, its grade
--     from the subject's boundaries, and how many were marked and not handed
--     in. The report writer shows it and suggests the Homework judgement from
--     it. The printed report shows the grade only ("Homework: B"), never the
--     percentage (the principal changed this from "average too" the same
--     day); a subject with no homework marks keeps the teacher's judgement.
--     Who may read it: the student's subject teacher, the Head of
--     Department, the period's assigned checkers, SMT and admins.
--
-- Counted: every mark recorded for homework due in the report period's term,
-- in any class of that subject, whether or not the marks were released to
-- students. The report is itself a deliberate publication, checked before it
-- goes out. "Excused" counts for nothing; "Not handed in" is counted
-- separately and is not a zero in the average.
--
-- Students already see their own released marks after moving class
-- (my_homework() includes homework they have a mark for). Parents still see
-- nothing about homework except the grade on the published report.

set local formwork.change_note = 'Principal (direct)';

-- 1. The student's current subject teacher reads their marks ---------------

create policy "Homework marks readable by the student's current subject teacher"
  on public.homework_marks for select to authenticated
  using (
    teaches_student_for_subject(student_id, subject_id)
    and exists (
      select 1 from homework h
      join academic_years y on y.academic_year_id = h.academic_year_id and y.status = 'current'
      where h.homework_id = homework_marks.homework_id));

-- 2. The term's homework, per student and subject, for reports -------------

create or replace function public.homework_report_summary(
  p_report_period_id integer,
  p_student_ids integer[],
  p_subject_id integer default null)
returns table (
  student_id integer,
  subject_id integer,
  average_pct numeric,
  grade text,
  marked integer,
  not_handed_in integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_from date;
  v_to date;
  v_all boolean;
  v_me integer;
begin
  if auth.uid() is null or not is_staff_or_admin() then
    raise exception 'Only staff can read homework for reports.';
  end if;

  select t.start_date, t.end_date into v_from, v_to
  from report_periods rp join terms t on t.term_id = rp.term_id
  where rp.report_period_id = p_report_period_id;
  if v_from is null then
    return;
  end if;

  -- The same people who can read the period's report comments see every
  -- student: admins, SMT, those who generate reports (admin only today) and
  -- the period's assigned checkers (report_checkers). A teacher sees the
  -- students they teach in that subject, and a Head of Department their
  -- department's subjects. Not the /reports/check page permission, which
  -- nearly every teacher has.
  select p.staff_id into v_me from profiles p where p.id = auth.uid();
  v_all := is_admin() or user_has_staff_role(array['smt'])
    or has_resource_access('/reports/generate')
    or exists (select 1 from report_checkers rc
               where rc.report_period_id = p_report_period_id and rc.staff_id = v_me);

  return query
  with marks as (
    select m.student_id, h.subject_id, m.grade, m.score, sch.kind,
           coalesce(h.out_of, sch.fixed_max) as max_score
    from homework_marks m
    join homework h on h.homework_id = m.homework_id
    join homework_schemes sch on sch.scheme_id = h.scheme_id
    where m.student_id = any(p_student_ids)
      and h.status = 'set'
      and h.due_on between v_from and v_to
      and (p_subject_id is null or h.subject_id = p_subject_id)
  ),
  summed as (
    select k.student_id, k.subject_id,
           round(avg(case when k.kind = 'mark' and k.score is not null and k.max_score > 0
                          then k.score / k.max_score * 100 end), 2) as average_pct,
           count(*) filter (where k.kind = 'mark' and k.score is not null)::integer as marked,
           count(*) filter (where k.grade = 'Not handed in')::integer as not_handed_in
    from marks k
    group by k.student_id, k.subject_id
  )
  select s.student_id, s.subject_id, s.average_pct,
         (select b.grade from subject_grade_boundaries b
            join students st on st.student_id = s.student_id
          where b.subject_id = s.subject_id and b.year_group = st.year_group
            and b.min_score <= s.average_pct
          order by b.min_score desc limit 1),
         s.marked, s.not_handed_in
  from summed s
  where v_all
     or teaches_student_for_subject(s.student_id, s.subject_id)
     or exists (
       select 1 from staff_roles sr join subjects sub on sub.department_name = sr.scope_value
       where sr.staff_id = v_me and sr.role_name = 'head_of_department'
         and sr.scope_type = 'department' and sub.subject_id = s.subject_id);
end;
$$;

revoke execute on function public.homework_report_summary(integer, integer[], integer) from public, anon;
grant execute on function public.homework_report_summary(integer, integer[], integer) to authenticated;
