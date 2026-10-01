-- Migration 310: an Attendance Officer role.
--
-- Why (the principal, 1 Oct 2026): "We need an attendance officer role and
-- this would also go to that role along with missed lessons. The
-- guardian.counselling@abc.sch.ng would get this role." The role gets the
-- missed-lesson pop-up (309) and the Missed Lessons page and tile (307–308).
-- guardian.counselling@ is Osione ILOEJE, who already had both through
-- pastoral and school_office; the role makes the job explicit, and can be
-- given to others at /staff/roles and extended at /admin/permissions.

set local formwork.change_note = 'Principal (direct)';

insert into public.roles (role_name, description) values
  ('attendance_officer', 'Follows up students missing from lessons: the missed-lesson pop-up and Missed Lessons (migration 310).')
on conflict (role_name) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('attendance_officer', '/office/missed-lesson-alerts'),
  ('attendance_officer', '/pastoral/missed-lessons')
on conflict do nothing;

insert into public.staff_roles (staff_id, role_name)
select st.staff_id, 'attendance_officer' from public.staff st
 where lower(btrim(st.email)) = 'guardian.counselling@abc.sch.ng'
on conflict do nothing;
