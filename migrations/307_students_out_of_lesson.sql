-- Migration 307: students who were in lessons earlier today but are not in
-- one now.
--
-- Why (the principal, 1 Oct 2026): "We need a tile that gives a list of
-- students who have marked present in some lessons so far [today] but is now
-- not in a lesson." Missing Registers says which registers haven't been
-- taken; nothing said which students had been seen in school and then
-- dropped out of sight, which is the list someone needs to go and find them.
--
-- students_out_of_lesson() looks at the period running right now (today's
-- school_day row whose start/end time contains the school clock; nothing
-- during breaks, before school or after Evening Prep, or outside term) and
-- lists every active student who was marked present or late at an earlier
-- period today and either:
--   - has been marked absent (an unauthorised code) at this period, or
--   - has nothing timetabled now: no lesson in any of their classes (a lesson
--     with its own teacher counts, migration 182) and, in the Other Half
--     period, no activity chosen for today.
-- Authorised absences (illness, appointments...) are accounted for and left
-- out, as is anyone whose register for this period hasn't been taken yet.
--
-- Returned as one json object: the current period (null when none is
-- running) and the students, each with where they were last seen.
-- SECURITY DEFINER so the answer doesn't depend on each table's policies,
-- and it checks the caller first: only holders of the new page's resource
-- (/pastoral/out-of-lesson: smt, pastoral, school_office, like Missing
-- Registers; admin always) can call it.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.students_out_of_lesson()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := school_today();
  v_now time := school_now()::time;
  v_day text := to_char(school_today(), 'Dy');
  v_period record;
  v_result json;
begin
  if not has_resource_access('/pastoral/out-of-lesson') then
    raise exception 'You do not have access to this list';
  end if;

  select sd.period_number, sd.period_name, sd.short_label, sd.start_time, sd.end_time
    into v_period
    from school_day sd
   where sd.day_of_week = v_day
     and sd.start_time <= v_now and v_now < sd.end_time
     and exists (select 1 from terms t where v_today between t.start_date and t.end_date)
   order by sd.start_time desc
   limit 1;

  if not found then
    return json_build_object('period', null, 'students', '[]'::json);
  end if;

  with earlier as (
    -- Each student's latest present/late mark at a period that started before this one.
    select distinct on (a.student_id) a.student_id, sd.period_name, sd.short_label, sd.start_time
      from attendance a
      join school_day sd on sd.day_of_week = v_day and sd.period_number = a.period_number
     where a.attend_date = v_today
       and a.status in ('present', 'late')
       and sd.start_time < v_period.start_time
     order by a.student_id, sd.start_time desc
  ), now_lessons as (
    select sc.student_id,
           string_agg(distinct c.class_code, ', ') as lesson,
           string_agg(distinct (st.first_name || ' ' || st.last_name), ', ') as teacher
      from student_class sc
      join timetable_slots ts on ts.class_id = sc.class_id
                              and ts.day_of_week = v_day
                              and ts.period_number = v_period.period_number
      join classes c on c.class_id = sc.class_id
      left join staff st on st.staff_id = coalesce(ts.staff_id, c.staff_id)
     group by sc.student_id
    union all
    select ch.student_id, 'Other Half: ' || a.activity_name, null
      from other_half_choices ch
      join other_half_activities a on a.activity_id = ch.activity_id
     where v_period.short_label = 'OH'
       and a.term_id = current_other_half_term()
       and a.day_of_week = v_day
       and a.is_active
  ), out_rows as (
    select s.student_id, s.first_name, s.last_name, s.preferred_name, s.year_group,
           s.form_class, s.boarding_house,
           e.period_name as last_seen_period, e.short_label as last_seen_label,
           case when m.status = 'absent' then 'marked_absent' else 'no_lesson' end as reason,
           ac.description as absence_code,
           nl.lesson, nl.teacher
      from earlier e
      join students s on s.student_id = e.student_id and s.status = 'active' and not s.is_demo
      left join attendance m on m.student_id = s.student_id
                            and m.attend_date = v_today
                            and m.period_number = v_period.period_number
      left join attendance_codes ac on ac.code = m.code
      left join lateral (
        select string_agg(x.lesson, ', ') as lesson, string_agg(x.teacher, ', ') as teacher
          from now_lessons x where x.student_id = s.student_id
      ) nl on true
     where m.status = 'absent'
        or (m.attendance_id is null and nl.lesson is null)
  )
  select json_build_object(
           'period', json_build_object(
             'period_number', v_period.period_number,
             'period_name', v_period.period_name,
             'short_label', v_period.short_label,
             'start_time', v_period.start_time,
             'end_time', v_period.end_time),
           'students', coalesce(json_agg(r order by r.reason, r.year_group, r.last_name, r.first_name), '[]'::json))
    into v_result
    from out_rows r;

  return v_result;
end;
$$;

revoke execute on function public.students_out_of_lesson() from public, anon;
grant execute on function public.students_out_of_lesson() to authenticated;

insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/out-of-lesson', 'Out of Lesson', 'Pastoral', 20)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('smt', '/pastoral/out-of-lesson'),
  ('pastoral', '/pastoral/out-of-lesson'),
  ('school_office', '/pastoral/out-of-lesson')
on conflict do nothing;
