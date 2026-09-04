-- ============================================
-- Migration 040: year_group on subject_grade_boundaries
-- Same subject can now have different grade scales per year
-- (e.g. WAEC A1-F9 for Year 12, IGCSE A*-G for other years).
-- Existing seeded rows are WAEC and were entered as a Year 12
-- guess, so they're backfilled to year_group = 12.
-- ============================================

alter table subject_grade_boundaries add column year_group integer;

update subject_grade_boundaries set year_group = 12;

alter table subject_grade_boundaries alter column year_group set not null;

alter table subject_grade_boundaries
  drop constraint subject_grade_boundaries_subject_id_grade_key;

alter table subject_grade_boundaries
  add constraint subject_grade_boundaries_subject_year_grade_key
  unique (subject_id, year_group, grade);
