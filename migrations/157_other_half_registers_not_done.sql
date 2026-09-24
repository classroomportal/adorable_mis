-- Migration 157: Other Half registers join Registers Not Done and the
-- register alerts.
--
-- Why: OH registers (migration 156) are taken per activity, not per class,
-- so registers_not_done — which is built from timetable_slots — never saw
-- them. An activity nobody took a register for went unnoticed everywhere
-- except the "Today" list on /other-half. The old whole-year Nova-T OH
-- classes (7a/Oh1 ...) were never listed either: they have no teacher, and
-- the view only lists slots with one.
--
-- 1. registers_not_done gains a second arm: one row per OH activity running
--    today whose register is outstanding. Same rules as a class — term in
--    session, 15 minutes past the start (that day's OH bell time), at least
--    one active student on it — and "taken" means any attendance mark today
--    carrying that activity's other_half_activity_id.
--
--    New columns, appended so existing readers are unaffected:
--      other_half_activity_id  set on OH rows, NULL on class rows
--      staff_ids               everyone the row belongs to — the class
--                              teacher, or every member of staff on the
--                              activity (an activity can have several, so
--                              staff_id is NULL on OH rows)
--    OH rows have no slot_id. class_code reads "Other Half: <activity>" so
--    the existing list shows what it is without a code change. An activity
--    with no staff assigned is still listed ("No staff assigned"), since its
--    register still needs taking.
--
-- 2. register_alerts gets other_half_activity_id, and
--    capture_register_alerts() raises one alert per member of staff on an
--    outstanding OH activity, once per activity per person per day — the
--    same per-day guard the class alerts use.

-- 1.
create or replace view registers_not_done
with (security_invoker = true) as
select ts.slot_id,
       c.staff_id,
       (s.first_name || ' ') || s.last_name as teacher_name,
       c.class_code,
       ts.period_number,
       p.period_name,
       p.short_label,
       ts.start_time,
       extract(epoch from school_now() - (school_today() + ts.start_time)) / 60::numeric as minutes_since_start,
       null::bigint as other_half_activity_id,
       array[c.staff_id] as staff_ids
  from timetable_slots ts
  join classes c on c.class_id = ts.class_id
  join staff s on s.staff_id = c.staff_id
  left join periods p on p.period_number = ts.period_number
 where ts.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy')
   and school_now() > (school_today() + ts.start_time + interval '15 minutes')
   and exists (select 1 from terms t
                where school_today() >= t.start_date and school_today() <= t.end_date)
   and exists (select 1 from student_class sc where sc.class_id = ts.class_id)
   and not exists (select 1 from attendance a
                     join student_class sc on sc.student_id = a.student_id
                    where sc.class_id = ts.class_id
                      and a.period_number = ts.period_number
                      and a.attend_date = school_today())
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
           string_agg(s.first_name || ' ' || s.last_name, ', ' order by s.last_name) as names
      from other_half_activity_staff x
      join staff s on s.staff_id = x.staff_id
     where x.activity_id = a.activity_id
  ) st on true
 where a.is_active
   and a.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy')
   and school_today() between t.start_date and t.end_date
   and school_now() > (school_today() + sd.start_time + interval '15 minutes')
   and exists (select 1 from other_half_choices c
                 join students stu on stu.student_id = c.student_id
                where c.activity_id = a.activity_id and stu.status = 'active')
   and not exists (select 1 from attendance m
                    where m.other_half_activity_id = a.activity_id
                      and m.attend_date = school_today());

-- 2.
alter table register_alerts
  add column if not exists other_half_activity_id bigint
    references other_half_activities (activity_id) on delete set null;

comment on column register_alerts.other_half_activity_id is
  'For an Other Half register: the activity whose register was late. NULL for class registers.';

create or replace function capture_register_alerts()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  insert into register_alerts (timetable_slot_id, staff_id, period_date, minutes_late, resolved, is_demo)
  select rnd.slot_id, rnd.staff_id, school_today(), round(rnd.minutes_since_start), false, ts.is_demo
    from registers_not_done rnd
    join timetable_slots ts on ts.slot_id = rnd.slot_id
   where not exists (
     select 1 from register_alerts ra
      where ra.timetable_slot_id = rnd.slot_id and ra.period_date = school_today()
   );

  insert into register_alerts (other_half_activity_id, staff_id, period_date, minutes_late, resolved, is_demo)
  select rnd.other_half_activity_id, sid, school_today(), round(rnd.minutes_since_start), false, false
    from registers_not_done rnd
   cross join lateral unnest(rnd.staff_ids) as sid
   where rnd.other_half_activity_id is not null
     and not exists (
       select 1 from register_alerts ra
        where ra.other_half_activity_id = rnd.other_half_activity_id
          and ra.staff_id = sid
          and ra.period_date = school_today()
     );
end;
$$;
