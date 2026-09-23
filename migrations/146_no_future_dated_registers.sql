-- Migration 146: a register can't be saved for a day that hasn't happened yet.
--
-- The staff timetable opens a register for the clicked column's day, always
-- looking forward: on a Wednesday, a click on the Mon cell opened *next*
-- Monday. A teacher who takes the same class in the same period every day
-- sees an identical row of cells, so one mis-click saved the whole morning
-- register against a date five days away. Today's register then looked
-- untaken, capture_register_alerts() logged the teacher as late, and the marks
-- sat on a future date where nobody would look for them. On 23 Sep 2026 that
-- was 11 marks for 12T/Me (moved back to the 23rd by hand), and ~77 other
-- rows from several classes were already sitting on Mon 28 Sep.
--
-- Nothing legitimately records attendance ahead of time — the register page
-- is the only writer — so refuse it here, where it holds whatever the page
-- does. Past dates stay open: correcting an earlier register is real work.
-- Uses school_today() (migration 123) so the cut-off is midnight in Lagos,
-- not UTC.

create or replace function reject_future_attendance()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.attend_date > school_today() then
    raise exception 'Cannot save a register for % — that date has not happened yet (today is %).',
      to_char(new.attend_date, 'Dy DD Mon YYYY'), to_char(school_today(), 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_future_attendance on attendance;
create trigger trg_reject_future_attendance
  before insert or update on attendance
  for each row execute function reject_future_attendance();
