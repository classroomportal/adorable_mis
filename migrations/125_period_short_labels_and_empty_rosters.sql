-- Migration 125: short period labels, and keep un-takeable registers off the
-- outstanding list.
--
-- 1. The register page badged a student's day with the raw period_number —
--    "P1", "P2", "P3". The school calls those M (mentor/registration), then
--    L1, L2 and so on, so every badge read one lesson ahead of what it meant.
--    periods.short_label carries the school's own abbreviation so nothing has
--    to derive it from the number again; periods.period_name stays the long
--    form ("Registration", "Period 1") that the dropdowns and tables use.
--
--    The label is data rather than a lookup in the app because the offset is
--    the school's, not a rule: Registration occupying number 1 is what pushes
--    every lesson's number one past its name.
--
-- 2. registers_not_done listed classes with nobody enrolled. A register cannot
--    be taken for an empty class — /attendance says "No students are linked to
--    this class yet" — so those rows could never clear. Harmless while the view
--    dropped everything after three hours; since migration 124 lifted that cap
--    they would accumulate all day and bury the real misses. 10 of today's 187
--    slots have an empty roster, 6 of them already listed. They are excluded
--    now: an unstaffed or unfilled class is a timetable problem, not a register
--    a teacher can take.

alter table periods add column if not exists short_label text;

comment on column periods.short_label is
  'The school''s own abbreviation for the period (M, L1..L6, OH, EP). Note period_number is offset from the lesson number because Registration is number 1 — never derive a label from the number.';

update periods set short_label = case period_name
  when 'Registration'    then 'M'
  when 'Period 1'        then 'L1'
  when 'Period 2'        then 'L2'
  when 'Period 3'        then 'L3'
  when 'Period 4'        then 'L4'
  when 'Period 5'        then 'L5'
  when 'Period 6'        then 'L6'
  when 'The Other Half'  then 'OH'
  when 'Evening Prep'    then 'EP'
  else period_name
end;

alter table periods alter column short_label set not null;

drop view if exists registers_not_done;

create view registers_not_done
with (security_invoker = true) as
  select ts.slot_id,
         c.staff_id,
         s.first_name || ' ' || s.last_name as teacher_name,
         c.class_code,
         ts.period_number,
         p.period_name,
         p.short_label,
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
    -- A class with no students on its roll has no register to take.
    and exists (
      select 1 from student_class sc where sc.class_id = ts.class_id
    )
    and not exists (
      select 1
      from attendance a
      join student_class sc on sc.student_id = a.student_id
      where sc.class_id = ts.class_id
        and a.period_number = ts.period_number
        and a.attend_date = school_today()
    );
