-- 223_staff_read_resolved_appeals.sql
--
-- The student profile's behaviour log now shows events withdrawn on appeal,
-- crossed out with the appeal's resolution notes (PR 206). Appeals were
-- readable only by pastoral/SMT/admin, so a teacher looking at the same
-- profile saw "Withdrawn on appeal" with no explanation. The principal asked
-- for teachers to see the notes too.
--
-- Any member of staff can now read an appeal once it has been decided. Pending
-- appeals stay pastoral/SMT/admin only (pastoral_read_all_appeals), since
-- they're still under review. Deciding appeals is unchanged: only
-- pastoral_update_appeals allows an update. Students and parents are
-- unaffected; is_staff_or_admin() is false for them.

create policy staff_read_resolved_appeals on public.behaviour_appeals
  for select to authenticated
  using (is_staff_or_admin() and status <> 'pending');
