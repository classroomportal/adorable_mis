-- ============================================
-- Migration 362: Sunday Evening Prep bell time
--
-- Why (the principal, 4 Oct 2026): a Year 11 student couldn't change their
-- Other Half choice on Sunday evening. Students may only change choices
-- during Evening Prep, and in_evening_prep() takes that from the 'EP' bell
-- time for today, which existed Monday to Friday only, though prep runs
-- Sunday to Friday.
--
-- How: a Sunday bell time for period 9 (EP) at the weekday times. Sunday
-- has no lessons, so nothing else changes: registers_not_done and planned
-- absences only use the OH bell time, and missed-lesson alerts need a
-- Sunday absent mark. Sunday is now on /admin/bell-times (not in its "make
-- these days the same" list). Applied through the connector on 4 Oct 2026.
-- ============================================

set local formwork.change_note = 'Principal (direct)';

insert into bell_times (day_of_week, period_number, start_time, end_time)
select 'Sun', period_number, start_time, end_time
  from bell_times
 where day_of_week = 'Mon' and period_number = 9
on conflict (day_of_week, period_number) do nothing;
