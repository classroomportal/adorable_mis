-- Migration 308: Out of Lesson becomes Missed Lessons.
--
-- Why (the principal, 1 Oct 2026, the same evening as 307): "I think I need
-- to change the logic to find anyone who has missed an odd lesson." 307 only
-- looked at the period running right now, so a student who skipped Period 2
-- and was back for Period 3 never appeared. What's wanted is the pattern:
-- in school that day, but missing from one or more lessons.
--
-- students_missed_lessons(p_date) lists, for one day (today by default),
-- every active student who has at least one present/late mark that day and
-- at least one unauthorised absence (status 'absent': codes N and O), at any
-- period, before or after the present marks. Each student comes with the
-- periods they were marked at, and for each missed one: the lesson they
-- should have been in (their class timetabled at that period, the lesson's
-- own teacher first as in migration 182; for the Other Half, the activity
-- the register belongs to), the code, and who marked it. Authorised
-- absences are accounted for and never count as missed.
--
-- The lesson for a past date is read from today's enrolments and timetable,
-- so it can be out of date after a class change; the marks themselves are
-- what they were.
--
-- 307's "no lesson this period" list is gone with it: it was about where a
-- student is right now, not about missed lessons.
--
-- The page moves from /pastoral/out-of-lesson to /pastoral/missed-lessons;
-- whoever was granted the old one keeps the new one. Same caller check:
-- SECURITY DEFINER, has_resource_access() first.
--
-- Applied through the connector on 1 Oct 2026 in pieces, because its tool
-- timed out on the DROP FUNCTION and DELETE below (it holds destructive
-- statements for a confirmation). Everything else went in, and execute on
-- students_out_of_lesson() was revoked from public, anon and authenticated;
-- the drop and the delete were left for the SQL editor, where the principal
-- ran them the same evening. The live database now matches this file.

set local formwork.change_note = 'Principal (direct)';

insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/missed-lessons', 'Missed Lessons', 'Pastoral', 20)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select role_name, '/pastoral/missed-lessons' from public.role_permissions
 where resource_key = '/pastoral/out-of-lesson'
on conflict do nothing;

delete from public.resources where resource_key = '/pastoral/out-of-lesson';

drop function if exists public.students_out_of_lesson();

create or replace function public.students_missed_lessons(p_date date default null)
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_date date := coalesce(p_date, school_today());
  v_day text := to_char(coalesce(p_date, school_today()), 'Dy');
  v_result json;
begin
  if not has_resource_access('/pastoral/missed-lessons') then
    raise exception 'You do not have access to this list';
  end if;

  with marks as (
    select a.attendance_id, a.student_id, a.period_number, a.status, a.code, a.staff_id,
           a.other_half_activity_id,
           coalesce(sd.period_name, p.period_name) as period_name,
           coalesce(sd.short_label, p.short_label) as short_label,
           sd.start_time
      from attendance a
      left join school_day sd on sd.day_of_week = v_day and sd.period_number = a.period_number
      left join periods p on p.period_number = a.period_number
     where a.attend_date = v_date
  ), picked as (
    select m.student_id from marks m
     group by m.student_id
    having bool_or(m.status in ('present', 'late')) and bool_or(m.status = 'absent')
  ), missed as (
    select m.student_id, m.period_number, m.period_name, m.short_label, m.start_time,
           ac.description as code_description,
           coalesce('Other Half: ' || oha.activity_name, les.lesson) as lesson,
           les.teacher,
           marker.first_name || ' ' || marker.last_name as marked_by
      from marks m
      join picked using (student_id)
      left join attendance_codes ac on ac.code = m.code
      left join other_half_activities oha on oha.activity_id = m.other_half_activity_id
      left join staff marker on marker.staff_id = m.staff_id
      left join lateral (
        select string_agg(distinct c.class_code, ', ') as lesson,
               string_agg(distinct (st.first_name || ' ' || st.last_name), ', ') as teacher
          from student_class sc
          join timetable_slots ts on ts.class_id = sc.class_id
                                  and ts.day_of_week = v_day
                                  and ts.period_number = m.period_number
          join classes c on c.class_id = sc.class_id
          left join staff st on st.staff_id = coalesce(ts.staff_id, c.staff_id)
         where sc.student_id = m.student_id
      ) les on true
     where m.status = 'absent'
  ), out_rows as (
    select s.student_id, s.first_name, s.last_name, s.preferred_name, s.year_group,
           s.form_class, s.boarding_house,
           (select json_agg(json_build_object('short_label', m.short_label, 'period_name', m.period_name, 'status', m.status)
                            order by m.start_time nulls last, m.period_number)
              from marks m where m.student_id = s.student_id) as day_marks,
           (select json_agg(json_build_object(
                     'period_name', x.period_name, 'short_label', x.short_label,
                     'start_time', x.start_time, 'lesson', x.lesson, 'teacher', x.teacher,
                     'code', x.code_description, 'marked_by', x.marked_by)
                   order by x.start_time nulls last, x.period_number)
              from missed x where x.student_id = s.student_id) as missed,
           (select count(*) from missed x where x.student_id = s.student_id) as missed_count
      from picked pk
      join students s on s.student_id = pk.student_id and s.status = 'active' and not s.is_demo
  )
  select json_build_object(
           'date', v_date,
           'students', coalesce(json_agg(r order by r.year_group, r.last_name, r.first_name), '[]'::json))
    into v_result
    from out_rows r;

  return v_result;
end;
$$;

revoke execute on function public.students_missed_lessons(date) from public, anon;
grant execute on function public.students_missed_lessons(date) to authenticated;
