-- Migration 112: close the tile-vs-write mismatches found while writing
-- sql/RLS_ACCESS_SUMMARY.md, per the school's explicit sign-off on each one.
--
-- These are additive: each adds a new policy alongside the existing
-- admin-only one (multiple permissive policies for the same operation
-- combine with OR), except attendance and staff_roles which narrow an
-- existing policy that was either too broad or needed an exclusion.

-- 1. school_office: "Needs to be able to edit core data" — insert/update
-- (not delete — leaving/removing a student stays admin-only) on students
-- and parents, plus full manage rights on the student_parent link table
-- since "manages parent-student links" inherently means adding and
-- removing links, not just editing them.
create policy "school_office_insert_students" on students
  for insert with check (user_has_staff_role(array['school_office']));
create policy "school_office_update_students" on students
  for update using (user_has_staff_role(array['school_office']))
  with check (user_has_staff_role(array['school_office']));

create policy "school_office_insert_parents" on parents
  for insert with check (user_has_staff_role(array['school_office']));
create policy "school_office_update_parents" on parents
  for update using (user_has_staff_role(array['school_office']))
  with check (user_has_staff_role(array['school_office']));

create policy "school_office_write_student_parent" on student_parent
  for all using (user_has_staff_role(array['school_office']))
  with check (user_has_staff_role(array['school_office']));

-- 2. hr: "Needs to be able to assign roles except admin" — full manage
-- rights on staff_roles, but explicitly excluded from ever touching a row
-- with role_name = 'admin' (can't grant it, can't edit or remove an
-- existing one). admin's own admin_write_staff_roles policy is untouched
-- and still unrestricted.
create policy "hr_manage_staff_roles" on staff_roles
  for all
  using (user_has_staff_role(array['hr']) and role_name <> 'admin')
  with check (user_has_staff_role(array['hr']) and role_name <> 'admin');

-- 3. assessment_user: "Needs to be able to import results" — insert/update
-- on results and target_grades (the role's own description is "Imports
-- results and target grades," and the mismatch covered both tables as one
-- issue). No delete — importing is add/update, not removal.
create policy "assessment_user_insert_results" on results
  for insert with check (has_staff_role(array['assessment_user']));
create policy "assessment_user_update_results" on results
  for update using (has_staff_role(array['assessment_user']));

create policy "assessment_user_insert_target_grades" on target_grades
  for insert with check (has_staff_role(array['assessment_user']));
create policy "assessment_user_update_target_grades" on target_grades
  for update using (has_staff_role(array['assessment_user']));

-- 4. assessment_manager: "Needs to be import cat4 etc" — full manage
-- rights on cat4_results and ngrt_results, matching how assessment_manager
-- is already trusted with full delete+reimport on target_grades/
-- transcript_grades via is_assessment_manager().
create policy "assessment_manager_write_cat4" on cat4_results
  for all using (has_staff_role(array['assessment_manager']))
  with check (has_staff_role(array['assessment_manager']));
create policy "assessment_manager_write_ngrt" on ngrt_results
  for all using (has_staff_role(array['assessment_manager']))
  with check (has_staff_role(array['assessment_manager']));

-- 5. attendance: "Attendance should be able to view. Named staff and
-- office write to attendance" — staff_write_attendance/staff_update_attendance
-- were named as if staff-only but actually checked auth.role() =
-- 'authenticated', so any logged-in account (parent, student) could write.
-- Narrow both to real staff (is_staff_or_admin(), the same gate
-- behaviour_events already uses) — this covers every staff role including
-- school_office, and shuts out non-staff accounts. Parents/students keep
-- their existing separate read-only policies.
alter policy "staff_write_attendance" on attendance
  with check (is_staff_or_admin() and (is_demo = is_demo_account()));
alter policy "staff_update_attendance" on attendance
  using (is_staff_or_admin() and (is_demo = is_demo_account()));
