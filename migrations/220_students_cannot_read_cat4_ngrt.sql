-- 220_students_cannot_read_cat4_ngrt.sql
--
-- Migration 214 narrowed CAT4 and NGRT scores from "every signed-in user"
-- to staff, the student themselves and their parents. The principal's
-- decision (27 Sep 2026): students must not see their own CAT4/NGRT
-- scores. Staff and parents are unchanged. No student page reads these
-- tables (only the staff student page, /students/[id], does), so nothing in
-- the portal changes.

set local formwork.change_note = 'Principal (direct)';

drop policy if exists student_read_own_cat4 on public.cat4_results;
drop policy if exists student_read_own_ngrt on public.ngrt_results;
