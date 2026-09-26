-- 195_missing_grades_new_students.sql
--
-- The "New students check" result set (calendar event 51) is only for
-- students who joined this term, the same group as its report period
-- (report_periods.joined_from, migration 193). /results/enter now offers only
-- those students, but missing_grades_by_class() still expected a mark from
-- every student in a class, so once one new Year 8 had a Science mark, every
-- other Year 8 in their Science class would have been listed as missing.
--
-- A result set's student group is taken from the report period linked to it
-- through report_periods.calendar_event_id - the link /calendar makes when it
-- creates a report period - rather than a second copy of the date on
-- calendar_events. When that period has joined_from, only students in its
-- year groups admitted on or after it are expected; every other result set
-- is unchanged. Otherwise the function is as migration 175 left it.

create or replace function public.missing_grades_by_class(p_event_id integer)
returns table(class_id integer, class_code text, subject_name text, year_group integer, teacher text, expected integer, entered integer, missing_students jsonb)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_date date;
  v_years integer[];
  v_joined_from date;
begin
  if not is_staff_or_admin() then
    raise exception 'Staff only' using errcode = 'insufficient_privilege';
  end if;

  select event_date into v_date from calendar_events where event_id = p_event_id and is_result_set;
  if v_date is null then
    raise exception 'Result set % not found', p_event_id;
  end if;

  select rp.year_groups, rp.joined_from into v_years, v_joined_from
  from report_periods rp
  where rp.calendar_event_id = p_event_id and rp.joined_from is not null
  order by rp.report_period_id
  limit 1;

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
      and (v_joined_from is null
           or (st.year_group = any (v_years) and st.admission_date >= v_joined_from))
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
$function$;
