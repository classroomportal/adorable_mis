-- Migration 247: copy the historic transcript grades into the per-year exam
-- result sets.
--
-- Why (principal, 28 Sept 2026): migration 246 created "Y07 Term 1 Exam"
-- and the rest back to 2017, but only the July 2026 marks were in results.
-- Everything before that (about 23,800 grades, Years 7-11) lived only in
-- transcript_grades, keyed by year group and term with no date, so every
-- earlier set was empty. Daniel MBA's "Y08 Term 3 Exam" showed no results,
-- although his Year 8 grades are on his transcript.
--
-- Each transcript grade becomes a mark in the set for the school year the
-- student sat it: their year group now minus the grade's year group, back
-- from 2026-27 (a current Y11's Year 8 grades are 2023-24's). Every student
-- with transcript grades has been promoted in step, the leavers included
-- (all left in July or September 2026), and all 23,640 such grades match a
-- set. The marks copy grade only: transcript_grades never held a score, so
-- score and max_score stay empty and the % charts (Subject Overview, Top
-- Ten) still can't show these sets. result_type is term_exam_import, as for
-- the July import.
--
-- Left alone:
--   - a grade whose set already has a mark for that student and subject
--     (2,790, the July 2026 exam, already in results since migration 246).
--     The transcript still reads transcript_grades second, so a WAEC grade
--     held there for one of those squares keeps printing on the WAEC version.
--   - 144 grades for a year group the student hasn't reached yet (four
--     students: Chidubem UGWU, Y8 with Year 10 grades; Jaden OZULUMBA and
--     Uju AYOGU, Y10 with Year 10/11 grades; Chidubem ONOVO, Y11 with Year 11
--     grades). Their school year can't be worked out; they stay in
--     transcript_grades, still on the transcript, for the school to check.
--
-- transcript_grades itself is untouched. grade_history logs every insert
-- (migration 215).
--
-- Safe to re-run: a mark already in its set is skipped.

set local formwork.change_note = 'Principal (direct)';

insert into results (student_id, subject_id, week_start_date, grade, result_type, result_set_event_id)
select tg.student_id, tg.subject_id, ce.event_date, tg.grade, 'term_exam_import', ce.event_id
from transcript_grades tg
join students s on s.student_id = tg.student_id
join calendar_events ce
  on ce.exam_year_group = tg.year_group
 and ce.exam_term = tg.term_number
 -- the school year the grade was sat: 2026-27 less the years since
 and ce.event_date between make_date(2026 - (s.year_group - tg.year_group), 8, 1)
                      and make_date(2027 - (s.year_group - tg.year_group), 7, 31)
where tg.year_group < s.year_group
  and not exists (
    select 1 from results r
    where r.student_id = tg.student_id
      and r.subject_id = tg.subject_id
      and r.result_set_event_id = ce.event_id
  );
