-- Migration 328: admin alone really can't add a student now.
--
-- Why: migration 275 (the principal's decision, 30 Sept 2026) meant to make
-- adding a student the school office's job alone, and left
-- school_office_insert_students as the only insert policy. But that policy
-- checks user_has_staff_role(array['school_office']), and
-- user_has_staff_role() lets every admin login through whatever roles it
-- holds. So any admin, including the shared "School Access" account, could
-- still add students. The new "What they can do" view on /admin/permissions
-- (migration 327) showed it on 2 Oct 2026.
--
-- has_staff_role() checks staff_roles only, with no admin bypass. Staff who
-- hold both admin and school_office (e.g. cs@) still add students through
-- their office role. Updating, reading and deleting students are unchanged.

set local formwork.change_note = 'Principal (direct)';

drop policy if exists school_office_insert_students on public.students;

create policy school_office_insert_students on public.students
  for insert with check (has_staff_role(array['school_office']));
