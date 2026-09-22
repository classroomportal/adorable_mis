-- Migration 133: the last three subjects with no target to read from.
--
-- Why: after migration 132, 129 rows across three subjects were still left
-- with nothing to show — Design Technology (84 students), Animal Husbandry
-- (29) and Government (16). The school has now named a source for each.
--
-- Design Technology was given as "Graphics or Maths". Graphics is taken: it is
-- the closer subject match, and it is also the emptier pool — 220 students
-- hold a Graphics target while only 5 are timetabled for it, so those targets
-- are otherwise doing nothing. Swapping it to Mathematics is a one-line
-- change if the school prefers.
--
-- As in 132, this writes no target grades. It points each subject at a target
-- that already exists.

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Graphics')
where subject_name = 'Design Technology';   -- 84 students

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Biology')
where subject_name = 'Hb';                  -- Animal Husbandry, 29 students

update subjects set target_fallback_subject_id = (select subject_id from subjects where subject_name = 'Sociology')
where subject_name = 'Gt';                  -- Government, 16 students
