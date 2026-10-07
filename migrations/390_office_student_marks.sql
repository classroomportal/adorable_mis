-- Migration 390: the office changes one student's register marks, lesson by
-- lesson, over a run of days.
--
-- Why (the principal, 7 Oct 2026): "Office also need to be able to edit marks
-- for individual lessons for one particular student over a period of time".
-- Until now a wrong mark could only be put right from each lesson's register,
-- one register at a time, and a planned absence (migrations 318 and 389) gives
-- the same code to every lesson. When a student is found to have been at the
-- dentist for two lessons last Tuesday and in sick bay for one on Thursday,
-- the office had to open five registers.
--
-- Now, at /attendance/student-marks (school office and attendance officer):
--   1. office_student_lessons(student, from, to): every lesson the student had
--      each day (timetable lessons of their classes, from the day they joined,
--      plus their Other Half activity), in term and not on a holiday, up to
--      today, with the mark each has and who gave it, plus any mark on a
--      period that is no longer on their timetable. At most 62 days at a time.
--   2. office_set_student_marks(student, marks): sets or clears a list of
--      marks, each {date, period, code, minutes_late}; an empty code removes
--      the mark. A changed mark is attributed to the member of the office
--      (staff_id) and stops being a planned-absence mark, as when the office
--      changes one on a register (migration 389). Marks that don't change
--      aren't written, so nothing is restamped or logged for them.
--
-- Both are the office's only (is_attendance_office(): school_office,
-- attendance_officer or admin), checked first. Every change and deletion is
-- logged in change_history (area registers) by the existing trigger, and the
-- other attendance triggers still run: no mark in the future
-- (reject_future_attendance), and an automatic missing-a-lesson negative is
-- withdrawn when its absent mark is corrected (migration 388). The function
-- is SECURITY DEFINER because the app has no delete grant on attendance, and
-- so that the office isn't stopped by an Other Half register another member
-- of staff has open (migration 385 already lets the office change a taken one).

set local formwork.change_note = 'Principal (direct)';

-- 1. Reading a student's lessons and marks --------------------------------------------------
create or replace function public.office_student_lessons(p_student_id integer, p_from date, p_to date)
returns table (
  attend_date date,
  period_number integer,
  period_name text,
  lesson text,
  teacher text,
  code text,
  status text,
  minutes_late integer,
  marked_by text,
  planned boolean,
  on_timetable boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_attendance_office() then
    raise exception 'Only the school office or the attendance officer can change a student''s marks here.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose a first and a last day, the last on or after the first.';
  end if;
  if p_to - p_from > 61 then
    raise exception 'Choose at most 62 days at a time.';
  end if;

  return query
  with days as (
    select gs::date as d, to_char(gs::date, 'Dy') as dow
      from generate_series(p_from, least(p_to, school_today()), interval '1 day') gs
     where exists (select 1 from terms t where gs::date between t.start_date and t.end_date)
       and not exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = gs::date)
  ),
  lessons as (
    select distinct on (x.d, x.period_number) x.d, x.period_number, x.lesson, x.teacher
      from (
        select dy.d, ts.period_number, c.class_code::text as lesson,
               (st.first_name || ' ' || st.last_name)::text as teacher, 1 as pref
          from days dy
          join student_class sc on sc.student_id = p_student_id and coalesce(sc.joined_on, dy.d) <= dy.d
          join timetable_slots ts on ts.class_id = sc.class_id and ts.day_of_week = dy.dow
          join classes c on c.class_id = ts.class_id
          left join staff st on st.staff_id = coalesce(ts.staff_id, c.staff_id)
        union all
        select dy.d, sd.period_number, ('Other Half: ' || a.activity_name)::text, null::text, 2
          from days dy
          join other_half_choices ch on ch.student_id = p_student_id
          join other_half_activities a on a.activity_id = ch.activity_id and a.is_active and a.day_of_week = dy.dow
          join terms t on t.term_id = a.term_id and dy.d between t.start_date and t.end_date
          join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
      ) x
     order by x.d, x.period_number, x.pref, x.lesson
  ),
  marks as (
    select att.attend_date, att.period_number, att.code, att.status, att.minutes_late,
           att.planned_absence_id, att.staff_id, att.other_half_activity_id
      from attendance att
     where att.student_id = p_student_id
       and att.attend_date between p_from and p_to
  )
  select coalesce(l.d, m.attend_date),
         coalesce(l.period_number, m.period_number),
         p.period_name::text,
         coalesce(l.lesson, case when oh.activity_name is not null then 'Other Half: ' || oh.activity_name end),
         l.teacher,
         m.code::text,
         m.status::text,
         m.minutes_late,
         case when ms.staff_id is not null then (ms.first_name || ' ' || ms.last_name)::text end,
         m.planned_absence_id is not null,
         l.d is not null
    from lessons l
    full join marks m on m.attend_date = l.d and m.period_number = l.period_number
    left join periods p on p.period_number = coalesce(l.period_number, m.period_number)
    left join staff ms on ms.staff_id = m.staff_id
    left join other_half_activities oh on oh.activity_id = m.other_half_activity_id
   order by 1, 2;
end;
$$;

revoke execute on function public.office_student_lessons(integer, date, date) from public, anon;
grant execute on function public.office_student_lessons(integer, date, date) to authenticated;

-- 2. Changing them --------------------------------------------------------------------------
create or replace function public.office_set_student_marks(p_student_id integer, p_marks jsonb)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id integer;
  m jsonb;
  v_date date;
  v_period integer;
  v_code text;
  v_status text;
  v_late integer;
  v_oh bigint;
  v_n integer;
  v_set integer := 0;
  v_removed integer := 0;
begin
  if not is_attendance_office() then
    raise exception 'Only the school office or the attendance officer can change a student''s marks here.'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from students s where s.student_id = p_student_id) then
    raise exception 'That student wasn''t found.';
  end if;
  if p_marks is null or jsonb_typeof(p_marks) <> 'array' or jsonb_array_length(p_marks) = 0 then
    return json_build_object('marks_set', 0, 'marks_removed', 0);
  end if;
  if jsonb_array_length(p_marks) > 600 then
    raise exception 'Too many marks at once; save at most 600.';
  end if;

  select p.staff_id into v_staff_id from profiles p where p.id = auth.uid();

  for m in select * from jsonb_array_elements(p_marks)
  loop
    v_date := (m->>'date')::date;
    v_period := (m->>'period')::integer;
    v_code := nullif(trim(coalesce(m->>'code', '')), '');
    if v_date is null or v_period is null
       or not exists (select 1 from periods p where p.period_number = v_period) then
      raise exception 'Each mark needs a day and a lesson.';
    end if;

    if v_code is null then
      delete from attendance a
       where a.student_id = p_student_id and a.attend_date = v_date and a.period_number = v_period;
      get diagnostics v_n = row_count;
      v_removed := v_removed + v_n;
      continue;
    end if;

    select ac.status into v_status from attendance_codes ac where ac.code = v_code;
    if v_status is null then
      raise exception 'There is no attendance code "%".', v_code using errcode = 'check_violation';
    end if;
    v_late := case when v_status = 'late' then nullif(m->>'minutes_late', '')::integer end;

    -- A new mark in the Other Half period belongs to the student's activity
    -- that day, as on the OH register and in planned absences.
    select ch.activity_id into v_oh
      from other_half_choices ch
      join other_half_activities a on a.activity_id = ch.activity_id
      join terms t on t.term_id = a.term_id
      join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
     where ch.student_id = p_student_id
       and a.is_active
       and a.day_of_week = to_char(v_date, 'Dy')
       and sd.period_number = v_period
       and v_date between t.start_date and t.end_date
     limit 1;

    insert into attendance as att (student_id, attend_date, period_number, code, status, minutes_late, staff_id, other_half_activity_id)
    values (p_student_id, v_date, v_period, v_code, v_status, v_late, v_staff_id, v_oh)
    on conflict (student_id, attend_date, period_number) do update
       set code = excluded.code,
           status = excluded.status,
           minutes_late = excluded.minutes_late,
           staff_id = excluded.staff_id,
           planned_absence_id = null,
           other_half_activity_id = coalesce(att.other_half_activity_id, excluded.other_half_activity_id)
     where (att.code, att.status, coalesce(att.minutes_late, -1))
           is distinct from (excluded.code, excluded.status, coalesce(excluded.minutes_late, -1));
    get diagnostics v_n = row_count;
    v_set := v_set + v_n;
    v_oh := null;
  end loop;

  return json_build_object('marks_set', v_set, 'marks_removed', v_removed);
end;
$$;

revoke execute on function public.office_set_student_marks(integer, jsonb) from public, anon;
grant execute on function public.office_set_student_marks(integer, jsonb) to authenticated;

-- 3. The page -------------------------------------------------------------------------------
insert into public.resources (resource_key, label, section, sort_order)
values ('/attendance/student-marks', 'Student Marks', 'Pastoral', 26)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('school_office', '/attendance/student-marks'),
  ('attendance_officer', '/attendance/student-marks')
on conflict do nothing;
