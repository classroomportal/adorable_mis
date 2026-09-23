-- Migration 153: the school day, day by day — which lessons run, what each
-- is called, and when.
--
-- Until now every weekday had the same nine periods with the same names
-- (the periods table); only the times could differ per day (bell_times,
-- migration 148). A day can now drop a lesson or call it something else,
-- e.g. a shorter Friday.
--
-- The model is bell_times itself: a row for a day and period means that
-- lesson runs that day, with those times — no row, no lesson. So the nine
-- period numbers stay fixed: they are Nova-T's nine slots per day (see
-- lib/novaTSlots.js) and what registers are keyed on. Only which of them
-- run, and their names, vary by day.
--
-- 1. Per-day names. NULL means "use the periods table's name", so the
--    usual name only needs setting once.
--
-- 2. A lesson can't be taken off a day while classes are still timetabled
--    then — those lessons would be left with no bell time and no place in
--    the day. Move or remove them first (e.g. through the Nova-T import).
--
-- 3. school_day: the resolved day, for anything that shows lesson names or
--    times. security_invoker so it reads through the caller's RLS.

-- 1.
alter table bell_times add column if not exists period_name text;
alter table bell_times add column if not exists short_label text;

comment on column bell_times.period_name is
  'Name of this lesson on this day. NULL = periods.period_name.';
comment on column bell_times.short_label is
  'Short label of this lesson on this day. NULL = periods.short_label.';

-- 2.
create or replace function bell_time_not_in_use()
returns trigger
language plpgsql
as $$
declare
  n integer;
begin
  select count(*) into n
    from timetable_slots
   where day_of_week = old.day_of_week and period_number = old.period_number;
  if n > 0 then
    raise exception '% class lesson(s) are still timetabled on % in period %; move them before taking this lesson off the day',
      n, old.day_of_week, old.period_number;
  end if;
  return old;
end;
$$;

drop trigger if exists bell_times_not_in_use on bell_times;
create trigger bell_times_not_in_use
  before delete on bell_times
  for each row execute function bell_time_not_in_use();

-- 3.
create or replace view school_day
with (security_invoker = true) as
select b.day_of_week,
       b.period_number,
       coalesce(b.period_name, p.period_name) as period_name,
       coalesce(b.short_label, p.short_label) as short_label,
       b.start_time,
       b.end_time
  from bell_times b
  join periods p on p.period_number = b.period_number;

grant select on school_day to authenticated;
