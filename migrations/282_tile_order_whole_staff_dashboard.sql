-- Migration 282: arrange the whole staff dashboard, not just its top row.
--
-- Why: the principal found (30 Sept 2026) that Arrange Tiles showed only the
-- top row of the staff dashboard (Log behaviour, My Timetable...), not row 2
-- (the numbers: active students, staff, behaviour alerts) or the larger
-- tiles underneath (Students, Pastoral, Admissions...), whose order was
-- still written into the code.
--
-- Now dashboard_tile_order also takes:
--   * 'staff_stats'   - row 2 of the staff dashboard;
--   * 'staff_modules' - the larger tiles underneath (also the bursar's home
--                       page, which shows only Fees & Bills and Tuckshop).
-- Seeded with today's order, so nobody's screen changes until someone
-- arranges it. As before, this only decides the order, never who sees what.

set local formwork.change_note = 'Principal (direct)';

alter table public.dashboard_tile_order drop constraint dashboard_tile_order_dashboard_check;
alter table public.dashboard_tile_order add constraint dashboard_tile_order_dashboard_check
  check (dashboard in ('student', 'staff', 'staff_stats', 'staff_modules'));

insert into public.dashboard_tile_order (dashboard, tile_key, position) values
  ('staff_stats', 'students', 0),
  ('staff_stats', 'staff', 1),
  ('staff_stats', 'alerts', 2),
  ('staff_modules', 'students', 0),
  ('staff_modules', 'pastoral', 1),
  ('staff_modules', 'admissions', 2),
  ('staff_modules', 'clinic', 3),
  ('staff_modules', 'reports', 4),
  ('staff_modules', 'comms', 5),
  ('staff_modules', 'timetable', 6),
  ('staff_modules', 'otherhalf', 7),
  ('staff_modules', 'assessment', 8),
  ('staff_modules', 'fees', 9),
  ('staff_modules', 'tuckshop', 10),
  ('staff_modules', 'staff', 11),
  ('staff_modules', 'administration', 12)
on conflict (dashboard, tile_key) do nothing;
