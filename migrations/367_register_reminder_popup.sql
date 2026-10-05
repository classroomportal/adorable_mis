-- Migration 367: pop-up on a teacher's screen when their register is not
-- taken 10 minutes into the lesson.
--
-- Why (the principal, 5 Oct 2026): the office gets a flashing pop-up when a
-- student goes missing from a lesson (309). The same kind of warning should
-- reach teachers who still haven't taken their register 10 minutes in, while
-- the lesson is going, rather than the register only turning up later on
-- Registers Not Done (15 minutes) for someone else to chase.
--
-- my_register_reminders() returns, for the signed-in teacher only, today's
-- lessons of theirs that started at least 10 minutes ago and have no register,
-- by the same rule as registers_not_done (157, 182, 318):
--   - their lessons: the lesson's own teacher if it has one, else the class's
--     (182); Other Half activities they are staff on (157);
--   - in term, and (unlike the view) not on a day with a 'holiday' calendar
--     event, so nobody is nagged on a public holiday;
--   - the class has students (an OH activity, active students);
--   - no mark at that period today other than planned-absence marks (318).
-- Earlier lessons today stay on it until taken: a register still matters
-- after the bell. Nothing is stored; once the register is saved the lesson
-- drops off by itself, so there is no "seen" button and no acks table.
--
-- The caller is identified through auth.uid() -> profiles.staff_id, never a
-- staff_id from the request (as in 315). It is SECURITY DEFINER and filters on
-- that staff member first, so the once-a-minute poll from every open page
-- stays cheap (315 records what reading the view per minute did at 08:00).
-- Null for someone with no staff record, so their page stops asking.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.my_register_reminders()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
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
               c.class_code as lesson,
               nullif(coalesce(ts.room, c.room), '') as room,
               (extract(epoch from (v_now - (v_today + ts.start_time))) / 60)::integer as minutes_since_start
          from timetable_slots ts
          join classes c on c.class_id = ts.class_id
          left join periods p on p.period_number = ts.period_number
         where coalesce(ts.staff_id, c.staff_id) = v_staff_id
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
$$;

revoke execute on function public.my_register_reminders() from public, anon;
grant execute on function public.my_register_reminders() to authenticated;
