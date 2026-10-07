-- 395: an Attendance card on the staff dashboard (the principal, 7 Oct 2026).
--
-- Taking a register (/attendance, from the Students card), Missing Registers,
-- Planned Absences, Student Marks (all three from the Pastoral card) and
-- Register Alerts (also on Pastoral) now sit together on their own card,
-- placed straight after Pastoral. Who can open each page is unchanged; only
-- the dashboard layout and the heading they're listed under at
-- /admin/permissions move.

set local formwork.change_note = 'Principal (direct)';

update public.dashboard_tile_order
   set position = position + 1
 where dashboard = 'staff_modules'
   and position > (select position from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'pastoral')
   and not exists (select 1 from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'attendance');

insert into public.dashboard_tile_order (dashboard, tile_key, position)
select 'staff_modules', 'attendance', position + 1
  from public.dashboard_tile_order
 where dashboard = 'staff_modules' and tile_key = 'pastoral'
on conflict do nothing;

update public.resources set section = 'Attendance'
 where resource_key in ('/attendance', '/pastoral/registers-not-done', '/attendance/planned-absences',
                        '/attendance/student-marks', '/admin/register-alerts');
