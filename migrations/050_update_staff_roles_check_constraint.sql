-- Migration 050: staff_roles_role_name_check was still locked to the old
-- six role names, silently rejecting inserts of any new role (hr, pastoral,
-- bursar, teacher, admin, school_office, admissions) — this is why the
-- checkboxes on /staff/roles appeared to do nothing.
--
-- Run this AFTER 049_reconcile_staff_roles.sql (which needs the old values
-- to still be valid while it renames them).

alter table staff_roles drop constraint staff_roles_role_name_check;

alter table staff_roles add constraint staff_roles_role_name_check
  check (role_name = ANY (ARRAY[
    'admin', 'smt', 'hr', 'pastoral', 'houseparent',
    'assessment_manager', 'assessment_user', 'teacher',
    'bursar', 'school_office', 'admissions'
  ]::text[]));
