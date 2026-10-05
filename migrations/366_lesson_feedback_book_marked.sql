-- Migration 366: lesson feedback, "Would you like extra help with this topic?"
-- becomes "Has your book been marked?".
--
-- Why: the principal, 5 Oct 2026, after seeing the mockups of migration 365:
-- there is no time set aside to give extra help, so the question would raise
-- an expectation the school can't meet; whether books are being marked is
-- worth knowing instead. Yes is the good answer.
--
-- No student had given feedback yet, so the question is reworded in place
-- (the guard trigger allows that only while it has no answers).
--
-- With no "neither" question left, the SMT named list's default filter is
-- now students who were red (page only).

set local formwork.change_note = 'Principal (direct)';

update public.lesson_feedback_questions
set question = 'Has your book been marked?', good_answer = true
where question = 'Would you like extra help with this topic?';
