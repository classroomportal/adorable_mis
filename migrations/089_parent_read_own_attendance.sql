-- Migration 089: let parents read their own children's attendance
--
-- attendance had zero parent-facing RLS policy — only staff_read_attendance
-- (staff/admin) existed, so a parent-facing Attendance tile would silently
-- return no rows however it queried. results already has exactly this
-- pattern (parent_read_own_results, migration history pre-088) via an
-- EXISTS join through profiles -> student_parent; this mirrors it for
-- attendance so the new parent-portal Attendance tile actually has data to
-- show.

create policy "parent_read_own_attendance" on attendance for select using (
  exists (
    select 1 from profiles p
    join student_parent sp on sp.parent_id = p.parent_id
    where p.id = auth.uid() and sp.student_id = attendance.student_id
  )
);
