-- ============================================
-- Migration 041: subject display names + target fallback
-- Does not touch subjects.subject_name (Nova-T source data).
-- display_name: friendly label shown in UI instead of raw code.
-- target_fallback_subject_id: when a subject has no target_grades
-- rows of its own, borrow another subject's targets for comparison
-- (e.g. Business has no targets -> use Economics targets instead).
-- ============================================

alter table subjects add column display_name text;
alter table subjects add column target_fallback_subject_id integer references subjects(subject_id);

comment on column subjects.display_name is 'Friendly override shown in UI. Falls back to subject_name if null.';
comment on column subjects.target_fallback_subject_id is 'If this subject has no target_grades of its own, borrow targets from this subject instead.';
