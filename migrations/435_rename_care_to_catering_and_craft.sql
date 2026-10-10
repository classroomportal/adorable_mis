-- 435: rename the subject "Care (Vocational)" to "Catering and Craft".
--
-- The principal, 10 Oct 2026: the Year 12 vocational subject the school
-- calls Care is Catering and Craft. Only the name changes: subject_id 91,
-- its Nova-T code `Ca` (so imports of 12a/Ca1 still resolve to it), its
-- department, results, boundaries and classes all stay as they are.
-- The class's block group label (set to 'Care' by migration 149) is
-- renamed with it so the timetable blocks read the same.

update subjects
   set subject_name = 'Catering and Craft'
 where subject_id = 91 and subject_name = 'Care (Vocational)';

update classes
   set block_group = 'Catering and Craft'
 where class_code = '12a/Ca1' and block_group = 'Care';
