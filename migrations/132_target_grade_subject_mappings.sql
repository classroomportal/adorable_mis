-- Migration 132: record where each subject's target grade is read from.
--
-- Why: 200 students take a subject that has no target of its own and reads
-- from nowhere, so nothing can be shown for it — 428 rows across 9 subjects.
-- The school has now said which subject should stand in for each.
--
-- This uses the existing subjects.target_fallback_subject_id, which means
-- "the subject whose target grade stands in for this one" and already carries
-- Business -> Economics. Setting it writes no target grade rows: it closes a
-- gap by pointing at a target that already exists. Nothing here touches
-- target_grades at all.
--
-- Note these subjects were ALREADY named, in display_name — Mu displays as
-- Music, He as Home Economics, Fa as Fashion, Gl as Global Perspectives, Hb as
-- Animal Husbandry, Gt as Government. subject_name holds the raw Nova-T source
-- name and /admin/subject-settings exists to keep exactly that split, so
-- nothing is renamed here. An earlier draft of this migration would have
-- overwritten subject_name; that was wrong and is gone.
--
-- Student counts are active students as at 22 September 2026.

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Food and Nutrition')
where subject_name = 'He';            -- Home Economics, 130 students -> the CAT4 "Food" column

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Art')
where subject_name = 'Mu';            -- Music, 84 without a target

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Art')
where subject_name = 'Fa';            -- Fashion, 22 without a target

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Sociology')
where subject_name = 'Gl';            -- Global Perspectives, 50 without a target

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Sociology')
where subject_name = 'Civics';        -- 100 Civics students hold no target of their own

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Spanish')
where subject_name = 'Igbo';          -- another modern language; CAT4 has no Igbo column

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Biology')
where subject_name = 'Science';       -- lower-school Science reads the Biology target

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Computing')
where subject_name in ('Digital Literacy', 'Computer and GSM Repairs');  -- 50 and 48 students

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Mathematics')
where subject_name = 'Further Maths'; -- 45 students

-- Left unmapped on purpose, and so still reported by /target-grades/coverage:
--   Design Technology  84 students
--   Animal Husbandry   29 students  (subject_name 'Hb')
--   Government         16 students  (subject_name 'Gt')
