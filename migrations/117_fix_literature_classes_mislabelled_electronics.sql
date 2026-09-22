-- 117_fix_literature_classes_mislabelled_electronics.sql
-- The three English Literature teaching groups were linked to a subject
-- called "Electronics", so the Literature lessons in the 10LI/11LI pathways
-- (and the Year 12 option set) rendered as "Electronics" on student and
-- staff timetables, printed timetables and the parent portal.
--
-- "El" is the school's own Nova-T code for Literature (confirmed by the
-- principal). sql/013_novacurr_timetable_import.sql did not know that: it
-- expanded each code suffix to a full subject name by guesswork, and guessed
-- "Electronics" for 10LI/El, 11LI/El and 12a/El1. The school teaches no
-- Electronics at all -- subject 98 exists only because that import invented
-- it, and those three groups are the only classes ever attached to it.
--
-- Corroborating what the code means, from the data itself:
--   * all three groups are taught by English teachers, each in the room
--     they teach their own English sets in -- EIO/AG1 (also 10a/En4,
--     11w/En1, 12a/En1), ECE/AG4 (10a/En1, 8C1/En, 9G1/En) and UIS/AT2
--     (10a/En2, 11w/En4, 12a/En2);
--   * "English Lit" (subject 299) already carries all the real academic
--     data for this subject -- 234 target grades, 38 transcript grades, 12
--     results, KS4 and KS5 key stages and the alias "Literature" -- but had
--     no classes at all pointing at it;
--   * 16 of the 18 students on the two pathway rosters already hold an
--     English Lit target grade.
--
-- So this repoints the classes at the subject that already owned their data,
-- which also reconnects those rosters to their targets and grade boundaries
-- in the progress and reporting screens.

update classes
set subject_id = (select subject_id from subjects where subject_name = 'English Lit')
where class_code in ('10LI/El', '11LI/El', '12a/El1')
  and subject_id = (select subject_id from subjects where subject_name = 'Electronics');

-- Show it under the name the school actually uses. "English Lit" is the
-- Nova-T source name and stays in subjects.subject_name; the subject_aliases
-- row for 299 is already "Literature", so match it in the UI. Reversible
-- from /admin/subject-settings by clearing the display name.
update subjects
set display_name = 'Literature'
where subject_name = 'English Lit'
  and display_name is null;

-- "Electronics" is now an orphan, and the only subject in the database with
-- neither classes nor any results, targets or transcripts -- every other
-- class-less subject (Add Maths, CCA, Extended, Social Science, ...) is
-- assessed without being timetabled. It is left in place rather than deleted
-- because deleting it would take its 50 subject_grade_boundaries rows with
-- it; removing it is a separate call for whoever owns the subject list.
--
-- Every other code suffix in classes.class_code was audited against the
-- subject it resolves to at the same time: each maps to exactly one subject,
-- and no other expansion is wrong. "El" was the only one.
