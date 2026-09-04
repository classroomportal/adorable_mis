-- ============================================
-- Migration 038: unique constraint on results
-- Allows upsert-on-reimport (correcting a week's file)
-- without creating duplicate rows.
-- ============================================

-- If duplicates already exist from earlier manual entry, this will fail.
-- Run this check first if unsure:
--   select student_id, subject_id, week_start_date, count(*)
--   from results group by 1,2,3 having count(*) > 1;

alter table results
  add constraint results_student_subject_week_unique
  unique (student_id, subject_id, week_start_date);
