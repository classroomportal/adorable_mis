-- Migration 076: layer demo-data filtering onto existing read policies
-- Each table keeps its existing role check unchanged and additionally requires
-- demo-ness to match the viewer: real staff (is_demo_account()=false) see only
-- is_demo=false rows, staff_demo sees only is_demo=true rows. is_admin() is OR'd
-- in as an escape hatch so admins can see both when provisioning/debugging —
-- mirrors the existing is_pastoral_or_smt() = is_admin() OR ... idiom already
-- used in sql/027_roles_permissions.sql.

drop policy if exists "staff_read_students" on students;
create policy "staff_read_students" on students for select using (
  is_staff_or_admin() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "read_all_classes" on classes;
create policy "read_all_classes" on classes for select using (
  auth.role() = 'authenticated' and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "read_all_timetable_slots" on timetable_slots;
create policy "read_all_timetable_slots" on timetable_slots for select using (
  auth.role() = 'authenticated' and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "read_all_student_class" on student_class;
create policy "read_all_student_class" on student_class for select using (
  auth.role() = 'authenticated' and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "read_all_staff" on staff;
create policy "read_all_staff" on staff for select using (
  auth.role() = 'authenticated' and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "staff_read_results" on results;
create policy "staff_read_results" on results for select using (
  is_staff_or_admin() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "read_all_target_grades" on target_grades;
create policy "read_all_target_grades" on target_grades for select using (
  is_staff_or_admin() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "staff_read_behaviour" on behaviour_events;
create policy "staff_read_behaviour" on behaviour_events for select using (
  is_staff_or_admin() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "pastoral_read_all_appeals" on behaviour_appeals;
create policy "pastoral_read_all_appeals" on behaviour_appeals for select using (
  is_pastoral_or_smt() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "staff_read_attendance" on attendance;
create policy "staff_read_attendance" on attendance for select using (
  is_staff_or_admin() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "staff_read_certificates" on certificates_awarded;
create policy "staff_read_certificates" on certificates_awarded for select using (
  is_staff_or_admin() and (is_demo = is_demo_account() or is_admin())
);
