-- ============================================
-- Migration 043: result_type on results
-- Distinguishes weekly ReLPs from formal Exams for the parent transcript.
-- Set at import time from the raw CSV header (before subject name parsing
-- strips the "Exam"/"Quiz" wording), not inferred after the fact.
-- ============================================

alter table results add column result_type text not null default 'ReLP';

comment on column results.result_type is
  'ReLP (weekly quiz) or Exam, set from the raw CSV header at import time.';
