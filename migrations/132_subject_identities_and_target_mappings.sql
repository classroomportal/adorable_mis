-- Migration 132: name the subjects the Nova-T import left as codes, and record
-- where each one's target grade is read from.
--
-- Why: six subjects carried two-letter names straight off the Nova-T group
-- codes — timetabled for between 18 and 130 students each, and impossible to
-- discuss, report on or set a target for. The school has now identified them.
-- These are the school's own answers, not names derived from the codes: the
-- original import guessed that way and turned the Literature code into
-- "Electronics" (migrations 117-118). subject_code is left untouched, so
-- Nova-T imports keep matching on it.
--
-- The mappings use the existing target_fallback_subject_id, which means "the
-- subject whose target grade stands in for this one" — already how Business
-- reads Economics' target. Setting one closes both sides of a gap at once and
-- writes no target grade rows at all. Nothing here overwrites a target anyone
-- has already set: migration 131's view treats a target held against the
-- subject itself as legitimate whether or not a mapping exists, so the 60
-- Civics, 25 Igbo and 25 Science targets already recorded stand.
--
-- Counts below are active students as at 22 September 2026.

-- 1. The subjects, named ---------------------------------------------------

update subjects set subject_name = 'Home Economics' where subject_name = 'He';   -- 130 students
update subjects set subject_name = 'Music' where subject_name = 'Mu';            -- 130 students
update subjects set subject_name = 'Global Perspectives' where subject_name = 'Gl'; -- 96 students

-- Hb (30), Fa (23) and Gt (18) are still unidentified and keep their codes for
-- now. They carry target grades by default, so they show up as missing on
-- /target-grades/reconcile rather than disappearing quietly.

-- 2. Where each subject's target is read from ------------------------------

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Food and Nutrition')
where subject_name = 'Home Economics';   -- Home Economics / Food, so the CAT4 "Food" column

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Sociology')
where subject_name = 'Civics';           -- 100 Civics students hold no target of their own

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Spanish')
where subject_name = 'Igbo';             -- another modern language, and CAT4 has no Igbo column

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Biology')
where subject_name = 'Science';          -- lower-school Science reads the Biology target

-- Music and Global Perspectives have no CAT4 column to read from and no
-- stand-in has been chosen, so they are left unmapped and will report as
-- missing until targets are set for them or they are marked as not carrying
-- one. Further Maths, Design Technology, Digital Literacy and Computer and
-- GSM Repairs are in the same position, still awaiting a decision.
