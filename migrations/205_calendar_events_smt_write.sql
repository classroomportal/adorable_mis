-- Academic Calendar events are edited by SMT.
--
-- calendar_events was writable only by is_admin() (profiles.role = 'admin'),
-- which is a single login — the rest of SMT could see the calendar but not
-- add, edit or delete events. The calendar is SMT's to run, so writes now go
-- through user_has_staff_role(array['smt']). That function also passes
-- profiles.role = 'admin', so the admin login keeps access. Reads are
-- unchanged: every signed-in member of staff can still see the calendar.
--
-- report_periods (created alongside a "Report period" event) already allows
-- admin/smt/assessment_manager, so the Add-event flow works end to end for SMT.

drop policy if exists admin_write_calendar_events on public.calendar_events;

create policy smt_write_calendar_events on public.calendar_events
  for all
  using (user_has_staff_role(array['smt']))
  with check (user_has_staff_role(array['smt']));

grant select, insert, update, delete on public.calendar_events to authenticated;
