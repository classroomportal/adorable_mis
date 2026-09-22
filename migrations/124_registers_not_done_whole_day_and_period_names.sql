-- Migration 124: an unmarked register stays on the list, and carries its
-- period's real name.
--
-- Two problems, both found from the live page after migration 123 went in.
--
-- 1. The view dropped a slot three hours after the period started, so a
--    register nobody ever took simply vanished. 101/Cv (Civics, Period 1,
--    08:20) had no marks at all today and was already invisible by lunchtime —
--    exactly the case the page exists to catch. The 15-minute grace stays;
--    the upper bound goes, so an outstanding register stays listed for the
--    rest of the school day. The day_of_week + school_today() test already
--    confines it to today, and capture_register_alerts()'s per-slot-per-day
--    guard means the longer window can't produce duplicate alerts.
--
-- 2. The page printed the raw period_number, but this school's period names
--    are offset by one: period_number 3 is "Period 2", period_number 5 is
--    "Period 4". A row reading "Period 3, started 09:55" therefore looked like
--    a timezone bug — the school's actual Period 3 starts at 11:15 — when the
--    clock was right and only the label was wrong. The view now carries
--    period_name so the page can show what staff call it.
--
-- Columns are only added, so existing readers (the pastoral page, the staff
-- timetable's own-missing count, capture_register_alerts) keep working.

create or replace view registers_not_done
with (security_invoker = true) as
  select ts.slot_id,
         c.staff_id,
         s.first_name || ' ' || s.last_name as teacher_name,
         c.class_code,
         ts.period_number,
         p.period_name,
         ts.start_time,
         extract(epoch from (school_now() - (school_today() + ts.start_time))) / 60 as minutes_since_start
  from timetable_slots ts
  join classes c on c.class_id = ts.class_id
  join staff s on s.staff_id = c.staff_id
  left join periods p on p.period_number = ts.period_number
  where ts.day_of_week = to_char(school_today(), 'Dy')
    and school_now() > (school_today() + ts.start_time) + interval '15 minutes'
    and exists (
      select 1 from terms t
      where school_today() >= t.start_date and school_today() <= t.end_date
    )
    and not exists (
      select 1
      from attendance a
      join student_class sc on sc.student_id = a.student_id
      where sc.class_id = ts.class_id
        and a.period_number = ts.period_number
        and a.attend_date = school_today()
    );
