-- Migration 252: Year 12 end-of-term exam sets for 2021-22 to 2025-26.
--
-- Why (principal, 29 Sept 2026): migration 246 built the per-year-group exam
-- sets on the understanding that the school had no Year 12 before this
-- September. The old system's exam export shows otherwise: 135 leavers who
-- left between 2022 and 2026 have "Y12 T1 Exam" and "Y12 T2 Exam" marks.
-- That fits the school growing a year group at a time: the Year 8s of
-- 2017-18 reached Year 12 in 2021-22. Year 12 sat Term 1 and Term 2 exams
-- only (Term 3 is WAEC), so there is no Y12 Term 3 set.
--
-- Each set is dated like the other year groups' sets of the same term, so
-- all year groups of a term still share a date (marks must carry
-- result_set_event_id, as migration 246 says).
--
-- The leavers' historic marks are loaded into these and the existing sets
-- separately, through the Supabase connector, since they are personal data
-- and don't belong in the repository.
--
-- Safe to re-run: a set already present (same name and date) is skipped.

set local formwork.change_note = 'Principal (direct)';

insert into calendar_events (event_date, event_name, category, is_result_set, exam_year_group, exam_term)
select t.exam_date::date,
       'Y12 Term ' || t.term_no || ' Exam',
       'exam',
       true,
       12,
       t.term_no
from (values
  -- school year starting, term, exam date (as migration 246)
  (2021, 1, '2021-12-06'), (2021, 2, '2022-03-21'),
  (2022, 1, '2022-12-05'), (2022, 2, '2023-03-20'),
  (2023, 1, '2023-12-04'), (2023, 2, '2024-03-18'),
  (2024, 1, '2024-12-02'), (2024, 2, '2025-03-17'),
  (2025, 1, '2025-12-01'), (2025, 2, '2026-03-16')
) as t(school_year, term_no, exam_date)
where not exists (
  select 1 from calendar_events ce
  where ce.event_date = t.exam_date::date
    and ce.event_name = 'Y12 Term ' || t.term_no || ' Exam'
);
