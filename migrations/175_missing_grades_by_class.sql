-- Migration 175: which classes still owe marks for a result set.
--
-- Why: after Week 1 TA staff could only find missing marks by spotting
-- blank squares on individual students' reports. /results/missing lists,
-- per class, how many active students have no mark for a chosen result
-- set and who they are, so SMT can chase the teacher.
--
-- A class is expected to have marks only if its subject was assessed in
-- its year group for that result set — i.e. someone in the year group has
-- a mark for it. Not every subject is tested every time (Week 1 was
-- English, Maths and Science for Years 7-9; English, Maths and pathway
-- subjects for 10-12), and the same rule decides the grey squares on the
-- Termly Grade Report (migration 174), so the two agree. The flip side:
-- if nobody in a year has entered a subject at all, its classes don't
-- show here.
--
-- A mark belongs to the result set if it carries its result_set_event_id,
-- or carries none and sits on the set's date (gradebook imports aren't
-- tagged) — the same rule as belongsToResultSet() on /classes/progress.
--
-- Done in the database because a single result set already passes the
-- 1,000-row cap on a client select. SECURITY DEFINER with a staff check:
-- it returns class codes, teacher names and student names, all of which
-- staff can already read.

create or replace function public.missing_grades_by_class(p_event_id integer)
returns table (
  class_id integer,
  class_code text,
  subject_name text,
  year_group integer,
  teacher text,
  expected integer,
  entered integer,
  missing_students jsonb
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_date date;
begin
  if not is_staff_or_admin() then
    raise exception 'Staff only' using errcode = 'insufficient_privilege';
  end if;

  select event_date into v_date from calendar_events where event_id = p_event_id and is_result_set;
  if v_date is null then
    raise exception 'Result set % not found', p_event_id;
  end if;

  return query
  with set_results as (
    select r.student_id, r.subject_id
    from results r
    where not r.is_demo
      and (r.result_set_event_id = p_event_id
           or (r.result_set_event_id is null and r.week_start_date = v_date))
  ),
  assessed as (
    select distinct sr.subject_id, s.year_group
    from set_results sr join students s on s.student_id = sr.student_id
  ),
  roster as (
    select c.class_id, c.subject_id, st.student_id, st.first_name, st.last_name,
           exists (select 1 from set_results sr
                   where sr.student_id = st.student_id and sr.subject_id = c.subject_id) as has_mark
    from classes c
    join assessed a on a.subject_id = c.subject_id and a.year_group = c.year_group
    join subjects sub on sub.subject_id = c.subject_id and sub.on_grade_report
    join student_class sc on sc.class_id = c.class_id
    join students st on st.student_id = sc.student_id and st.status = 'active'
    where not c.is_demo
  )
  select c.class_id, c.class_code, coalesce(sub.display_name, sub.subject_name), c.year_group,
         nullif(trim(coalesce(t.first_name, '') || ' ' || coalesce(t.last_name, '')), ''),
         count(*)::integer,
         count(*) filter (where ro.has_mark)::integer,
         coalesce(
           jsonb_agg(jsonb_build_object('student_id', ro.student_id, 'first_name', ro.first_name, 'last_name', ro.last_name)
                     order by ro.last_name, ro.first_name)
             filter (where not ro.has_mark),
           '[]'::jsonb)
  from roster ro
  join classes c on c.class_id = ro.class_id
  join subjects sub on sub.subject_id = c.subject_id
  left join staff t on t.staff_id = c.staff_id
  group by c.class_id, c.class_code, sub.display_name, sub.subject_name, c.year_group, t.first_name, t.last_name;
end;
$$;

revoke execute on function public.missing_grades_by_class(integer) from public, anon;
grant execute on function public.missing_grades_by_class(integer) to authenticated;
