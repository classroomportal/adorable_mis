-- Migration 275: only the school office can add a new student.
--
-- Why: on 29 Sept 2026 a test student ("Idris Oyibo", born 1988, Year 10)
-- and a parent login for him were added to the live database, and the
-- portal welcome email went out to a real outside address. The principal
-- removed them on 30 Sept and decided that adding a student is the school
-- office's job alone: holding admin is no longer enough.
--
-- Until now students had two insert routes: school_office_insert_students
-- (staff holding school_office) and admin_write_students, a FOR ALL policy
-- that let any admin (including the shared "School Access" account,
-- mis-sa@) insert as well. This splits the admin policy into select, update
-- and delete, so admins can still see, correct and remove student records,
-- and leaves school_office_insert_students as the only way to add one. That
-- covers both /students/new and /students/import, which insert straight
-- into students as the signed-in user.
--
-- Staff who hold both admin and school_office (e.g. cs@) can still add
-- students, through their office role. To stop someone adding students,
-- remove their school_office role, not their admin role.

set local formwork.change_note = 'Principal (direct)';

drop policy if exists admin_write_students on public.students;

create policy admin_read_students on public.students
  for select using (is_admin());

create policy admin_update_students on public.students
  for update using (is_admin()) with check (is_admin());

create policy admin_delete_students on public.students
  for delete using (is_admin());
