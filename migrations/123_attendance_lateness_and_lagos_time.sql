-- Migration 123: minutes-late on the register, and register lateness measured
-- in Lagos time rather than the database's UTC.
--
-- Three problems this fixes.
--
-- 1. "Late" carried no magnitude. A student five minutes late and one who
--    strolled in at half past ten were both just `status = 'late'`, so nobody
--    could total lateness for a pastoral conversation or a report. Teachers now
--    enter how late, and attendance.minutes_late stores it.
--
-- 2. registers_not_done compared now() (UTC on this instance — check with
--    `select current_setting('TimeZone')`) against timetable_slots.start_time,
--    which is Lagos wall-clock time. Lagos is UTC+1 all year, so every check
--    ran an hour behind: the 08:00 registration only appeared on the
--    not-done list at 09:15 Lagos instead of 08:15, and the 3-hour window
--    slid with it. The day_of_week test used current_date too, so between
--    23:00 and midnight Lagos it looked at the previous day's timetable.
--    school_today()/school_now() make the timezone explicit and are used
--    everywhere the comparison happens, including capture_register_alerts(),
--    which was stamping register_alerts.period_date with the UTC date.
--
-- 3. registers_not_done decided a register was done by matching
--    attendance.staff_id to the class's teacher — but nothing has ever written
--    staff_id (all 2320 rows at time of writing have it null), so no register
--    ever counted as done and every teacher sat permanently on the list. The
--    check now looks for marks against the students actually enrolled in that
--    class, which is what "the register was taken" means and works for the
--    existing rows as well as new ones. The app also starts writing staff_id
--    so there is an audit trail of who marked what.

-- --------------------------------------------------------------------------
-- School-local time
-- --------------------------------------------------------------------------

create or replace function school_today()
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;

comment on function school_today() is
  'Today''s date at the school (Africa/Lagos). Use instead of current_date for anything compared against a timetable or a register.';

create or replace function school_now()
returns timestamp
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select (now() at time zone 'Africa/Lagos');
$$;

comment on function school_now() is
  'Current wall-clock time at the school (Africa/Lagos), naive so it can be compared directly with timetable_slots.start_time.';

grant execute on function school_today() to authenticated;
grant execute on function school_now() to authenticated;

-- --------------------------------------------------------------------------
-- How late is late
-- --------------------------------------------------------------------------

alter table attendance add column if not exists minutes_late integer;

comment on column attendance.minutes_late is
  'Minutes after the start of the period the student arrived. Only meaningful when status = ''late''; the trigger below clears it otherwise.';

alter table attendance drop constraint if exists attendance_minutes_late_check;
alter table attendance add constraint attendance_minutes_late_check
  check (minutes_late is null or (minutes_late >= 0 and minutes_late <= 600));

-- A register can be re-marked — late this morning, corrected to present this
-- afternoon. Nulling the minutes in a trigger rather than a check constraint
-- means that correction just works instead of failing on a stale value the
-- form no longer shows.
create or replace function clear_minutes_late_unless_late()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status is distinct from 'late' then
    new.minutes_late := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clear_minutes_late_unless_late on attendance;
create trigger trg_clear_minutes_late_unless_late
  before insert or update on attendance
  for each row execute function clear_minutes_late_unless_late();

-- --------------------------------------------------------------------------
-- Views, on Lagos time
-- --------------------------------------------------------------------------

create or replace view attendance_today
with (security_invoker = true) as
  select a.student_id,
         a.attend_date,
         a.period_number,
         a.code,
         ac.description,
         a.status,
         (a.status = 'present') as is_present,
         a.minutes_late
  from attendance a
  join attendance_codes ac on ac.code = a.code
  where a.attend_date = school_today()
    and ((a.is_demo = is_demo_account()) or is_admin());

create or replace view registers_not_done
with (security_invoker = true) as
  select ts.slot_id,
         c.staff_id,
         s.first_name || ' ' || s.last_name as teacher_name,
         c.class_code,
         ts.period_number,
         ts.start_time,
         extract(epoch from (school_now() - (school_today() + ts.start_time))) / 60 as minutes_since_start
  from timetable_slots ts
  join classes c on c.class_id = ts.class_id
  join staff s on s.staff_id = c.staff_id
  where ts.day_of_week = to_char(school_today(), 'Dy')
    and school_now() > (school_today() + ts.start_time) + interval '15 minutes'
    and school_now() < (school_today() + ts.start_time) + interval '3 hours'
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

-- Rewritten only to swap current_date for school_today(); the search_path pin
-- below was on the live definition and has to be carried over, or a
-- SECURITY DEFINER function starts resolving names against the caller's path.
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
end;
$$;

-- --------------------------------------------------------------------------
-- Summary for a student's record
-- --------------------------------------------------------------------------

-- Three windows in one round trip, counted in the database rather than by
-- pulling a year of rows to the browser — a full year is roughly 1,700 marks
-- per student, well past PostgREST's default row limit.
--
-- The academic year starts at the first term beginning on or after 1 August;
-- if terms haven't been entered for the year yet it falls back to 1 August
-- itself, so the window is never empty.
--
-- Deliberately not SECURITY DEFINER: staff and parents see exactly the rows
-- the attendance RLS policies already grant them.
create or replace function student_attendance_summary(p_student_id integer)
returns table (
  scope text,
  window_start date,
  sessions bigint,
  present bigint,
  late bigint,
  authorized_absence bigint,
  absent bigint,
  late_minutes bigint,
  late_with_minutes bigint
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  with bounds as (
    select
      school_today() as today,
      school_today() - (extract(isodow from school_today())::int - 1) as week_start,
      case
        when extract(month from school_today()) >= 8
          then make_date(extract(year from school_today())::int, 8, 1)
        else make_date(extract(year from school_today())::int - 1, 8, 1)
      end as august
  ),
  window_starts as (
    select
      b.today,
      b.week_start,
      coalesce(
        (select min(t.start_date) from terms t
          where t.start_date >= b.august and t.start_date < b.august + interval '1 year'),
        b.august
      ) as year_start
    from bounds b
  ),
  marks as (
    select a.attend_date, a.status, a.minutes_late
    from attendance a, window_starts w
    where a.student_id = p_student_id
      and a.attend_date >= w.year_start
      and a.attend_date <= w.today
  ),
  scopes as (
    select * from (values ('today', 1), ('week', 2), ('year', 3)) as v(scope, ord)
  )
  select
    sc.scope,
    case sc.scope when 'today' then w.today when 'week' then w.week_start else w.year_start end,
    count(m.attend_date),
    count(*) filter (where m.status = 'present'),
    count(*) filter (where m.status = 'late'),
    count(*) filter (where m.status = 'authorized_absence'),
    count(*) filter (where m.status = 'absent'),
    coalesce(sum(m.minutes_late), 0),
    count(*) filter (where m.status = 'late' and m.minutes_late is not null)
  from scopes sc
  cross join window_starts w
  left join marks m on (
    (sc.scope = 'today' and m.attend_date = w.today) or
    (sc.scope = 'week' and m.attend_date >= w.week_start) or
    (sc.scope = 'year')
  )
  group by sc.scope, sc.ord, w.today, w.week_start, w.year_start
  order by sc.ord;
$$;

comment on function student_attendance_summary(integer) is
  'Attendance counts for one student over today, this week (Monday onwards) and the academic year so far, with total minutes late. Respects attendance RLS.';

grant execute on function student_attendance_summary(integer) to authenticated;
