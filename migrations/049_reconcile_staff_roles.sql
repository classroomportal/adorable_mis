-- Migration 049: reconcile staff_roles with the new role vocabulary in
-- roles/role_permissions (migration 046). Old role names are renamed to
-- their closest new equivalent. head_of_department has no direct
-- equivalent in the new list and is mapped to 'teacher' — review anyone
-- who held this role afterwards and reassign to assessment_manager or
-- another role if 'teacher' isn't right for them.

-- sysadmin -> admin
update staff_roles set role_name = 'admin' where role_name = 'sysadmin';

-- class_teacher -> teacher
update staff_roles set role_name = 'teacher' where role_name = 'class_teacher';

-- head_of_department -> teacher (closest available; review individually)
-- Use a temp move + delete-duplicates pattern in case someone already
-- holds both head_of_department and class_teacher (would collide on the
-- staff_roles primary key once both become 'teacher').
insert into staff_roles (staff_id, role_name)
select staff_id, 'teacher' from staff_roles where role_name = 'head_of_department'
on conflict do nothing;
delete from staff_roles where role_name = 'head_of_department';

-- smt, houseparent, assessment_manager already match — no change needed.

-- Sanity check: list anyone whose role_name doesn't exist in the new roles
-- table after this migration (should return zero rows).
-- select distinct role_name from staff_roles where role_name not in (select role_name from roles);
