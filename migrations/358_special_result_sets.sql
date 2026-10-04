-- Migration 358: special result sets for particular year groups (e.g. Year
-- 12 mocks), kept under their own name, on the reports, off the transcript.
--
-- Why (the principal, 4 Oct 2026): "Sometimes we record a special set of
-- marks for a particular year. An example would be year 12 mocks. I need to
-- add to the calendar and marks be stored not against a week but against
-- its name. It should still go on report but not on transcript."
--
-- Marks are already saved against a result set's event (results.
-- result_set_event_id), but everything that lays marks out by week reads
-- week_start_date, which /results/enter sets to the set's date. So Year 12's
-- mocks on Thursday 8 October would have been printed in the Termly Grade
-- Report's week 3 column, beside (or instead of) that week's Week 4 TA, and
-- would have counted that week as "assessed" for the shading.
--
-- 1. calendar_events.special_year_groups: set (at /calendar) on a result
--    set that is only for those year groups. Such a set
--      - must be a result set, and can never be an end-of-term exam set
--        (exam_year_group stays null; check constraint). The KS3/KS4-5
--        transcripts read only exam sets and legacy transcript_grades, so
--        a special set's marks never reach a transcript.
--      - takes marks only for students currently in those year groups:
--        results_special_set_year_check() refuses anyone else on insert,
--        or when a mark is moved to the set or to another student. It is
--        not re-checked on later edits, so a mark can still be corrected
--        after the student has gone up a year.
-- 2. report_week_assessments() (migration 174) leaves special-set marks
--    out, so they no longer make a week look assessed.
-- 3. report_special_set_assessments(): for the Termly Grade Report, the
--    special sets in a date range that concern the student (they have a
--    mark in it, or are in its year groups now) and which subjects were
--    marked in each. Subject ids only, no marks or names; same caller check
--    as report_week_assessments(). The report prints each such set in place
--    of the week column its date falls in, headed by its name (the
--    principal: "Year 12 mocks will replace a weekly report column").
--
-- The written report already takes the term's marks by date, so a special
-- set's grade is on it with no change (an exam-grade mark there is the
-- grade printed beside the subject, as for any exam).

-- Not re-runnable as written: the constraint and trigger are created without
-- "drop ... if exists" (the connector holds back any statement with drop).

set local formwork.change_note = 'Principal (direct)';

alter table public.calendar_events
  add column if not exists special_year_groups smallint[];

alter table public.calendar_events add constraint calendar_events_special_set_check
  check (special_year_groups is null or (
    is_result_set
    and exam_year_group is null
    and cardinality(special_year_groups) between 1 and 7
    and 7 <= all (special_year_groups)
    and 13 >= all (special_year_groups)
  ));

comment on column public.calendar_events.special_year_groups is
  'Set on a special result set (e.g. Year 12 mocks, migration 358): the year groups it is for. Its marks are shown '
  'under its name rather than in a week column, are on the reports and never on a transcript. Null on every other event.';

-- 1. Only students in the set's year groups.
create or replace function public.results_special_set_year_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_years smallint[];
  v_name text;
  v_year integer;
begin
  if new.result_set_event_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.result_set_event_id is not distinct from old.result_set_event_id
     and new.student_id = old.student_id then
    return new;
  end if;

  select special_year_groups, event_name into v_years, v_name
  from calendar_events where event_id = new.result_set_event_id;
  if v_years is null then
    return new;
  end if;

  select year_group into v_year from students where student_id = new.student_id;
  if v_year is null or not (v_year = any (v_years)) then
    raise exception '"%" is only for Year %; this student is in Year %.',
      v_name, array_to_string(v_years, ', '), coalesce(v_year::text, '?')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.results_special_set_year_check() from public, anon, authenticated;

create trigger trg_results_special_set_year
  before insert or update of result_set_event_id, student_id on public.results
  for each row execute function public.results_special_set_year_check();

-- 2. Weeks: special-set marks don't count.
create or replace function public.report_week_assessments(p_student_id integer, p_from date, p_to date)
returns table(subject_id integer, week_start_date date, enrolled boolean)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not (
    is_staff_or_admin()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.student_id = p_student_id)
    or p_student_id in (select my_current_child_ids())
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
    and not exists (
      select 1 from calendar_events ce
      where ce.event_id = r.result_set_event_id and ce.special_year_groups is not null
    )
  union
  select distinct c.subject_id, null::date, true
  from student_class sc
  join classes c on c.class_id = sc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  where sc.student_id = p_student_id
    and sub.on_grade_report;
end;
$function$;

-- 3. Special sets for the Termly Grade Report.
create or replace function public.report_special_set_assessments(p_student_id integer, p_from date, p_to date)
returns table(event_id integer, event_name text, event_date date, subject_id integer)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not (
    is_staff_or_admin()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.student_id = p_student_id)
    or p_student_id in (select my_current_child_ids())
  ) then
    raise exception 'Not allowed to view this student''s report' using errcode = 'insufficient_privilege';
  end if;

  return query
  with sets as (
    select ce.event_id, ce.event_name, ce.event_date
    from calendar_events ce
    where ce.special_year_groups is not null
      and ce.event_date between p_from and p_to
      and (
        (select s.year_group from students s where s.student_id = p_student_id) = any (ce.special_year_groups)
        or exists (select 1 from results r where r.result_set_event_id = ce.event_id and r.student_id = p_student_id)
      )
  )
  select st.event_id, st.event_name, st.event_date, m.subject_id
  from sets st
  left join lateral (
    select distinct r.subject_id from results r
    where r.result_set_event_id = st.event_id and not r.is_demo
  ) m on true;
end;
$function$;

revoke execute on function public.report_special_set_assessments(integer, date, date) from public, anon;
grant execute on function public.report_special_set_assessments(integer, date, date) to authenticated;
