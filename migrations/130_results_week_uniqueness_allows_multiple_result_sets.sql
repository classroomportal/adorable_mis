-- Migration 130: stop the weekly uniqueness rule on `results` from colliding
-- with result sets.
--
-- Why: `results` carries two unique constraints, and the two pages that write
-- scores key on different ones —
--
--   /results/enter            upserts on (student_id, subject_id, result_set_event_id)
--   /results/import-gradebook upserts on (student_id, subject_id, week_start_date)
--
-- `results_student_subject_week_unique` is the older of the two. It encodes
-- the original ReLP model — one score per subject per student per week — and
-- that model no longer holds. The school now records named result sets
-- (calendar_events.is_result_set) and `result_type` has four values, so a
-- student can legitimately have a short test and a teacher assessment in the
-- same subject in the same week.
--
-- The two rules collide in production as of today. September Term 2026 starts
-- on Monday 21 September, which is exactly the date of the "Week 1 TA" result
-- set. /results/enter writes week_start_date = the result set's date, so a
-- gradebook import for week 1 and a teacher entering Week 1 TA scores for the
-- same student and subject are the same (student, subject, week) — whichever
-- is saved second is refused with a bare duplicate-key error naming a
-- constraint that means nothing to the person who hit it. Two result sets
-- sharing a date would fail the same way.
--
-- The fix keeps both writers' conflict targets intact rather than picking a
-- winner. The week rule gains `result_set_event_id`, with NULLS NOT DISTINCT
-- so that it still behaves exactly as before for the import: those rows carry
-- no result set, and under NULLS NOT DISTINCT two NULLs collide, so
-- re-importing a week still updates the existing row instead of duplicating
-- it. Rows that do carry a result set are now distinguished by it.
--
-- What each writer gets:
--   import, re-importing a week         updates in place, as before
--   teacher entering a result set       no longer blocked by an imported row
--                                       for the same week, or by another
--                                       result set sharing its date
--   teacher re-saving a result set      unchanged — still the (student,
--                                       subject, result_set_event_id) rule
--
-- Verified against the live database before writing this, in a rolled-back
-- transaction: all three above behave as described.
--
-- Note the constraint becomes a unique index rather than a table constraint.
-- NULLS NOT DISTINCT is available on both (PG15+, this database is 17.6), but
-- an index is the honest shape for something that exists to back an ON
-- CONFLICT inference, and PostgREST infers it identically.

alter table results drop constraint results_student_subject_week_unique;

create unique index results_student_subject_week_event_unique
  on results (student_id, subject_id, week_start_date, result_set_event_id)
  nulls not distinct;

comment on index results_student_subject_week_event_unique is
  'One result per student per subject per week per result set. NULLS NOT '
  'DISTINCT so rows with no result set (the gradebook import) still dedupe '
  'by week, which is what /results/import-gradebook upserts against.';
