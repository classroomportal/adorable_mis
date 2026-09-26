-- 193_report_period_new_students.sql
--
-- "Y7 Settling in" has become "New students check" (calendar event 51 was
-- renamed on /calendar). It is now about every student who joined the school
-- this term, whatever their year, not about Year 7. A report period could
-- only say which year groups it covers, so it had no way to express that.
--
-- report_periods gets joined_from: when set, the period covers only active
-- students in its year groups whose admission_date is on or after that date.
-- NULL (every existing period, and the default) keeps today's behaviour of
-- covering the whole year group. A student with no admission_date is never
-- counted as new - an unknown date isn't evidence they joined recently - so
-- they need one set on their record to appear.
--
-- Period 1 is pointed at all years and joined_from = 1 August 2026. This
-- term's joiners were admitted on 14 September, a week before the September
-- Term's start_date (21 September, when lessons began), so the term's own
-- start date would miss every one of them; the summer holiday is the real
-- boundary. That takes in the 48 Year 7s and 14 new students in Years 8-10,
-- and leaves out the Year 11 student admitted on 20 April 2026 (last term).
--
-- No grants: this only adds a column to an existing table.

alter table public.report_periods
  add column joined_from date;

comment on column public.report_periods.joined_from is
  'When set, the period covers only students in year_groups admitted on or after this date (e.g. a new students check). NULL = everyone in year_groups.';

update public.report_periods
set name = 'New students check',
    year_groups = array[7, 8, 9, 10, 11, 12],
    joined_from = date '2026-08-01'
where report_period_id = 1;

update public.calendar_events
set year_group_note = 'New students'
where event_id = 51;
