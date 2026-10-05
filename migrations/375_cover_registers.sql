-- Migration 375: registers for covered lessons go to the cover teacher.
--
-- Why: the principal, 5 Oct 2026: when SMT arrange cover (migration 374),
-- the teacher covering the lesson is the one in the room, so the register
-- reminders must go to them, not to the absent teacher.
--
--   * registers_not_done: a lesson with a live cover today is listed against
--     the cover teacher (staff_id, staff_ids, and "(cover)" after their name
--     in teacher_name). capture_register_alerts() and
--     my_overdue_registers_count() read the view, so the register alert and
--     the overdue banner on My Timetable follow it with no change of their own.
--   * my_register_reminders() (the 10-minute pop-up, migration 367): the cover
--     teacher gets the covered lesson, shown as "<class> (cover)"; the absent
--     teacher no longer gets it.
--
-- Everything else in both is unchanged from migrations 367 and 318. The view
-- keeps security_invoker; staff can read lesson_covers (374).

set local formwork.change_note = 'Principal (direct)';

create or replace view public.registers_not_done
with (security_invoker = true) as
 select ts.slot_id,
    coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id) as staff_id,
    (s.first_name || ' ' || s.last_name) || case when lc.cover_id is not null then ' (cover)' else '' end as teacher_name,
    c.class_code,
    ts.period_number,
    p.period_name,
    p.short_label,
    ts.start_time,
    extract(epoch from school_now() - (school_today() + ts.start_time)) / 60::numeric as minutes_since_start,
    null::bigint as other_half_activity_id,
    array[coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id)] as staff_ids
   from timetable_slots ts
     join classes c on c.class_id = ts.class_id
     left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
       and lc.cover_date = school_today() and lc.cancelled_at is null
     join staff s on s.staff_id = coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id)
     left join periods p on p.period_number = ts.period_number
  where ts.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy')
    and school_now() > (school_today() + ts.start_time + '00:15:00'::interval)
    and exists (select 1 from terms t where school_today() >= t.start_date and school_today() <= t.end_date)
    and exists (select 1 from student_class sc where sc.class_id = ts.class_id)
    and not exists (
      select 1 from attendance a
        join student_class sc on sc.student_id = a.student_id
       where sc.class_id = ts.class_id and a.period_number = ts.period_number
         and a.attend_date = school_today() and a.planned_absence_id is null)
union all
 select null::integer as slot_id,
    null::integer as staff_id,
    coalesce(st.names, 'No staff assigned') as teacher_name,
    'Other Half: ' || a.activity_name as class_code,
    sd.period_number,
    sd.period_name,
    sd.short_label,
    sd.start_time,
    extract(epoch from school_now() - (school_today() + sd.start_time)) / 60::numeric as minutes_since_start,
    a.activity_id as other_half_activity_id,
    coalesce(st.ids, '{}'::integer[]) as staff_ids
   from other_half_activities a
     join terms t on t.term_id = a.term_id
     join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
     left join lateral (
       select array_agg(s.staff_id order by s.last_name) as ids,
              string_agg((s.first_name || ' ') || s.last_name, ', ' order by s.last_name) as names
         from other_half_activity_staff x
         join staff s on s.staff_id = x.staff_id
        where x.activity_id = a.activity_id) st on true
  where a.is_active
    and a.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy')
    and school_today() >= t.start_date and school_today() <= t.end_date
    and school_now() > (school_today() + sd.start_time + '00:15:00'::interval)
    and exists (
      select 1 from other_half_choices c
        join students stu on stu.student_id = c.student_id
       where c.activity_id = a.activity_id and stu.status = 'active')
    and not exists (
      select 1 from attendance m
       where m.other_half_activity_id = a.activity_id and m.attend_date = school_today()
         and m.planned_absence_id is null);

create or replace function public.my_register_reminders()
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_staff_id integer;
  v_today date := school_today();
  v_now timestamp := school_now();
  v_dy text := to_char(school_today(), 'Dy');
begin
  select p.staff_id into v_staff_id from profiles p where p.id = auth.uid();
  if v_staff_id is null then
    return null;
  end if;
  if not exists (select 1 from terms t where v_today between t.start_date and t.end_date)
     or exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = v_today) then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(row_to_json(x) order by x.start_time, x.lesson)
      from (
        select ts.slot_id, ts.class_id, null::bigint as other_half_activity_id,
               ts.period_number, coalesce(p.period_name, 'Period ' || ts.period_number) as period_name,
               ts.start_time, ts.end_time,
               c.class_code || case when lc.cover_id is not null then ' (cover)' else '' end as lesson,
               nullif(coalesce(ts.room, c.room), '') as room,
               (extract(epoch from (v_now - (v_today + ts.start_time))) / 60)::integer as minutes_since_start
          from timetable_slots ts
          join classes c on c.class_id = ts.class_id
          left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
            and lc.cover_date = v_today and lc.cancelled_at is null
          left join periods p on p.period_number = ts.period_number
         where coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id) = v_staff_id
           and ts.day_of_week = v_dy
           and v_now >= v_today + ts.start_time + interval '10 minutes'
           and exists (select 1 from student_class sc where sc.class_id = ts.class_id)
           and not exists (
             select 1 from attendance a
               join student_class sc on sc.student_id = a.student_id
              where sc.class_id = ts.class_id and a.period_number = ts.period_number
                and a.attend_date = v_today and a.planned_absence_id is null)
        union all
        select null, null, a.activity_id,
               sd.period_number, sd.period_name,
               sd.start_time, sd.end_time,
               'Other Half: ' || a.activity_name,
               nullif(a.room, ''),
               (extract(epoch from (v_now - (v_today + sd.start_time))) / 60)::integer
          from other_half_activity_staff x
          join other_half_activities a on a.activity_id = x.activity_id
          join terms t on t.term_id = a.term_id
          join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
         where x.staff_id = v_staff_id
           and a.is_active
           and a.day_of_week = v_dy
           and v_today between t.start_date and t.end_date
           and v_now >= v_today + sd.start_time + interval '10 minutes'
           and exists (
             select 1 from other_half_choices ch
               join students s on s.student_id = ch.student_id
              where ch.activity_id = a.activity_id and s.status = 'active')
           and not exists (
             select 1 from attendance m
              where m.other_half_activity_id = a.activity_id and m.attend_date = v_today
                and m.planned_absence_id is null)
      ) x
  ), '[]'::json);
end;
$function$;
