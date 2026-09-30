-- Migration 277: let grade_history record homework grades.
--
-- Why: migration 276 put trg_log_grade_change on homework_marks, as CLAUDE.md
-- requires for every grade table, but grade_history only accepts rows from the
-- three reporting tables (grade_history_table_name_check, migration 215). The
-- first homework mark saved would have failed. Found by testing the pilot
-- before anyone used it; no homework mark had been saved.
--
-- The log itself is unchanged: still append-only, rows are only added. This
-- only widens the list of tables a row may come from.

set local formwork.change_note = 'Principal (direct)';

alter table public.grade_history drop constraint if exists grade_history_table_name_check;
alter table public.grade_history add constraint grade_history_table_name_check
  check (table_name = any (array['results', 'target_grades', 'transcript_grades', 'homework_marks']));
