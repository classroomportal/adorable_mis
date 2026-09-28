-- Migration 246: end-of-term exam result sets per year group, back to 2017,
-- and the July 2026 exam relinked into them.
--
-- Why (principal, 28 Sept 2026): the school wants every end-of-term exam
-- since it opened to sit in Formwork as a result set named after the year
-- group that sat it, so a Year 10 student's December exam is
-- "Y10 Term 1 Exam". The calendar keeps one school-wide exam per term ("T1
-- Exam"); the result set is per year group. There are three terms a year
-- (September, January, April), each ending in an exam.
--
-- 1. Structured columns. calendar_events gains exam_year_group and
--    exam_term, set only on these sets. The transcripts
--    (lib/generateKeyStageTranscript.js) find "Year 10, Term 1" through
--    them, never by parsing the name, which an admin can edit at /calendar.
--
-- 2. Sets from 2017-18 to 2025-26. The school opened in September 2017 with
--    Years 7 and 8 and added a year group each September. It had no Year 12
--    until this September (the July 2026 marks cover Years 7-11 only). So
--    2017-18 gets Y07-Y08, 2018-19 Y07-Y09, 2019-20 Y07-Y10, and every year
--    from 2020-21 gets Y07-Y11: 117 sets. Most are empty for now. They're
--    prepared so the pre-2021 students can be added and their marks loaded
--    into them. The same name recurs every year (there is a "Y07 Term 1
--    Exam" every December). Pickers show the date beside the name, which
--    tells them apart.
--
--    The exact exam dates weren't recorded. Each is a Monday near the end of
--    its term, close enough for ordering; an admin can correct them at
--    /calendar. The exception is 2025-26 Term 3, dated 19 July 2026 to match
--    the marks already held for it. All the year groups of one term share a
--    date. So a mark in one of these sets must carry result_set_event_id,
--    because the date alone no longer says which set it belongs to.
--
-- 3. The July 2026 exam. Its 2,956 marks were held under a single "T3 Exam"
--    set (event 48), untagged and matched by date. Each mark now moves to
--    the set for the year group the student was in then, which is their
--    year group now minus one: everyone with a July mark has since been
--    promoted, so current Y12 marks become "Y11 Term 3 Exam", current Y8's
--    "Y07 Term 3 Exam". Only result_set_event_id changes; grade, score and
--    everything else stay as they were. grade_history logs each move
--    (migration 215). "T3 Exam" stays on the calendar but stops being a
--    result set, since its marks now live in the per-year sets.
--
-- Mark entry pages still leave sets from earlier school years out
-- (currentYearSets()), as with any past set.
--
-- Safe to re-run: sets already present (same name and date) are skipped, and
-- the relink only touches marks with no result set.

set local formwork.change_note = 'Principal (direct)';

alter table calendar_events
  add column if not exists exam_year_group smallint
    check (exam_year_group between 7 and 13),
  add column if not exists exam_term smallint
    check (exam_term between 1 and 3);

alter table calendar_events drop constraint if exists calendar_events_exam_slot_both_or_neither;
alter table calendar_events add constraint calendar_events_exam_slot_both_or_neither
  check ((exam_year_group is null) = (exam_term is null));

comment on column calendar_events.exam_year_group is
  'Set on an end-of-term exam result set: the year group that sat it (e.g. 10 '
  'for "Y10 Term 1 Exam"). The transcripts place marks by this and exam_term, '
  'never by the event name. Null on every other event.';
comment on column calendar_events.exam_term is
  'Set on an end-of-term exam result set: which term''s exam it is (1-3). '
  'Always set together with exam_year_group.';

insert into calendar_events (event_date, event_name, category, is_result_set, exam_year_group, exam_term)
select t.exam_date::date,
       'Y' || lpad(yg::text, 2, '0') || ' Term ' || t.term_no || ' Exam',
       'exam',
       true,
       yg,
       t.term_no
from (values
  -- school year starting, term, exam date
  (2017, 1, '2017-12-04'), (2017, 2, '2018-03-19'), (2017, 3, '2018-07-02'),
  (2018, 1, '2018-12-03'), (2018, 2, '2019-03-18'), (2018, 3, '2019-07-01'),
  (2019, 1, '2019-12-02'), (2019, 2, '2020-03-16'), (2019, 3, '2020-06-29'),
  (2020, 1, '2020-11-30'), (2020, 2, '2021-03-15'), (2020, 3, '2021-06-28'),
  (2021, 1, '2021-12-06'), (2021, 2, '2022-03-21'), (2021, 3, '2022-07-04'),
  (2022, 1, '2022-12-05'), (2022, 2, '2023-03-20'), (2022, 3, '2023-07-03'),
  (2023, 1, '2023-12-04'), (2023, 2, '2024-03-18'), (2023, 3, '2024-07-01'),
  (2024, 1, '2024-12-02'), (2024, 2, '2025-03-17'), (2024, 3, '2025-06-30'),
  (2025, 1, '2025-12-01'), (2025, 2, '2026-03-16'), (2025, 3, '2026-07-19')
) as t(school_year, term_no, exam_date)
-- Opened with Y7-Y8 in 2017, one more year group each year, up to Y11.
cross join lateral generate_series(7, least(11, 8 + (t.school_year - 2017))) as yg
where not exists (
  select 1 from calendar_events ce
  where ce.event_date = t.exam_date::date
    and ce.event_name = 'Y' || lpad(yg::text, 2, '0') || ' Term ' || t.term_no || ' Exam'
);

-- The July 2026 marks, into the set for the year group each student was in.
update results r
set result_set_event_id = ce.event_id
from students s, calendar_events ce
where s.student_id = r.student_id
  and r.week_start_date = '2026-07-19'
  and r.result_set_event_id is null
  and ce.event_date = '2026-07-19'
  and ce.exam_term = 3
  and ce.exam_year_group = s.year_group - 1;

do $$
declare
  left_over integer;
begin
  select count(*) into left_over
  from results
  where week_start_date = '2026-07-19' and result_set_event_id is null;
  if left_over > 0 then
    raise exception 'Migration 246: % July 2026 marks could not be matched to a year group set', left_over;
  end if;
end $$;

update calendar_events
set is_result_set = false
where event_name = 'T3 Exam' and event_date = '2026-07-19' and exam_year_group is null;
