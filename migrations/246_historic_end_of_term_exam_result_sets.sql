-- Migration 246: historic end-of-term exam result sets, one per year group.
--
-- Why: the school wants its exam history since opening to sit in Formwork as
-- named result sets, so past exam marks can be loaded against them and read
-- on the student, class progress and Subject Overview pages.
--
-- How they're named: the calendar carries one school-wide exam per term, but
-- a result set is per year group, named after the year group sitting it —
-- a Year 10 student's December exam is "Y10 Term 1 Exam". There are three
-- terms (September, January, April), each ending in an exam.
--
-- Which year groups: the school opened in September 2021 with Year 7 only
-- (the current Year 12, whose earliest admission date is 1 Sept 2021) and
-- has added a year group each September since — the earliest admission in
-- each current year group is exactly one year later than the one above it.
-- So 2021-22 gets Y07 only, 2022-23 Y07–Y08, and so on to 2025-26 Y07–Y11:
-- 40 sets, not a full grid of year groups that didn't exist yet.
--
-- The same name recurs each year (there is a "Y07 Term 1 Exam" every
-- December); the pickers show each set's date beside its name, which tells
-- them apart.
--
-- 2025-26 Term 3 is deliberately not created. That is the July 2026 exam,
-- already in Formwork as "T3 Exam" (19 July 2026) with about 3,000 marks
-- across the then Years 7–11, untagged and matched to it by date. New sets
-- on that date would make those marks ambiguous (lib/resultSets.js and
-- missing_grades_by_class() match untagged marks by date). Splitting it into
-- "Y07 Term 3 Exam" … "Y11 Term 3 Exam" means re-tagging those marks too,
-- which is a separate change.
--
-- The year groups of one term share a date, so marks loaded into these sets
-- must carry result_set_event_id: an untagged mark on a shared date can't be
-- told apart by date alone.
--
-- The exact exam dates were not recorded. Each is a Monday near the end of
-- its term (early December, mid/late March, end of June/early July), close
-- enough for ordering; an admin can correct them at /calendar. They fall
-- before the current school year, so the mark entry pages leave them out
-- (currentYearSets()), as with any past set.
--
-- Safe to re-run: a set that already exists by name and date is left alone.

insert into calendar_events (event_date, event_name, category, is_result_set)
select t.exam_date::date,
       'Y' || lpad(yg::text, 2, '0') || ' Term ' || t.term_no || ' Exam',
       'exam',
       true
from (values
  -- school year starting, term, exam date
  (2021, 1, '2021-12-06'), (2021, 2, '2022-03-21'), (2021, 3, '2022-07-04'),
  (2022, 1, '2022-12-05'), (2022, 2, '2023-03-20'), (2022, 3, '2023-07-03'),
  (2023, 1, '2023-12-04'), (2023, 2, '2024-03-18'), (2023, 3, '2024-07-01'),
  (2024, 1, '2024-12-02'), (2024, 2, '2025-03-17'), (2024, 3, '2025-06-30'),
  (2025, 1, '2025-12-01'), (2025, 2, '2026-03-16')
) as t(school_year, term_no, exam_date)
-- Year 7 opened in 2021; one more year group each year after.
cross join lateral generate_series(7, 7 + (t.school_year - 2021)) as yg
where not exists (
  select 1 from calendar_events ce
  where ce.event_date = t.exam_date::date
    and ce.event_name = 'Y' || lpad(yg::text, 2, '0') || ' Term ' || t.term_no || ' Exam'
);
