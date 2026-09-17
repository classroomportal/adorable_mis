-- Migration 090: let parents read their own parent<->student links
--
-- Discovered testing the new parent-portal dashboard (migration 089) with a
-- real parent login: student_parent had only admin_write_student_parent and
-- read_student_parent_pastoral (is_pastoral_or_smt() only) — no policy let a
-- parent read their own rows at all. So the "My Children" query
-- (student_parent.select('students(...)').eq('parent_id', ...)) has been
-- silently returning zero rows for every real parent account, regardless of
-- whether the actual link exists — confirmed live: parent_id 348 genuinely
-- has 2 children in student_parent, RLS was just hiding them from the
-- parent themselves. `students` already has the equivalent
-- parent_read_own_child policy with this same join; student_parent was the
-- missing link in the chain. Same pattern as parent_read_own_results /
-- parent_read_own_attendance.

create policy "parent_read_own_links" on student_parent for select using (
  exists (
    select 1 from profiles p
    where p.id = auth.uid() and p.parent_id = student_parent.parent_id
  )
);
