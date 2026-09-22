-- Migration 115: CAT4 target grades for the 2026/27 intake and other
-- students who were carrying none.
--
-- Source: "CAT4_Predicted_Grades.xlsx", sheet "CAT4 Merged" -- 30 students,
-- 22 subjects each, supplied by the school. The sheet's own footnote warns
-- that some cells are a linear regression of Mean SAS against known grades
-- per subject rather than an official GL Assessment estimate, so these are
-- working targets, not published ones.
--
-- Why this is a migration and not a run of /target-grades/import: that page
-- matches on UPN alone, and a third of the sheet's "Student ID" column holds
-- admissions placeholders ("New01", "Yr8Jan", "NEW 2026", "20016") instead of
-- UPNs, so it would have dropped those rows. They are resolved here against
-- the live students table by name + date of birth.
--
-- Three of those resolutions were judgement calls, recorded so they can be
-- unpicked if wrong:
--   * "Yr8Jan"  -> N703939825080, Ogbuefi EZEANI. Same surname, exact DOB
--     (2013-12-04), admitted 2026-01-12 (hence the placeholder), and his
--     existing targets track this row's to within three subjects. The sheet
--     gives the forename as "Onyedikachi".
--   * "20016"   -> N703939826023, David CHIEDOZIE. Exact name and the only
--     student of that name on roll, but the sheet's DOB is 2015-04-26
--     against 2014-06-10 on record.
--   * "New9"    -> W703939826020, Ikemsinachi EZE. Exact name and the only
--     student of that name on roll, sheet DOB 2013-03-30 against 2013-09-10.
-- To unpick one, delete that student_id's rows from target_grades.
--
-- Five sheet rows are deliberately NOT covered, because the student is not on
-- roll under any spelling. They need admitting through /students/new first --
-- year group can't be inferred, the DOB bands overlap across year groups --
-- and then a follow-up migration for their targets:
--   new7    Bryan AKONOBIALEX       2013-07-19  Male
--   NEW11   Millicent OKORO         2014-07-27  Female
--   New8    Kamsi JOE-ONYEKWELU     2012-08-20  Female
--   New 10  Netochukwu ILANG        2012-06-09  Male
--   New 28  Ifeoma Vitalis Uchenwa  2011-06-21  Female
--
-- The insert is ON CONFLICT DO NOTHING on purpose. Seven of these students
-- already carry targets from the earlier CAT4 import, and on seven subjects
-- across four of them the sheet disagrees with what is on record. Existing
-- grades are left exactly as they are and only missing subjects are filled
-- in; revising a target already in use is the assessment lead's call, not a
-- side effect of an import.

begin;

-- One row per student, grades in the sheet's own column order, so a row here
-- reads straight off against a row of the spreadsheet.
create temporary table cat4_sheet (upn text not null, grades text[] not null)
  on commit drop;

insert into cat4_sheet (upn, grades) values
  ('E703939825115', array['B','B','C','B','B','C','C','B','B','B','B','B','B','B','B','B','B','B','B','B','B','B']),  -- Chukwuebuka AYOGU
  ('V703939825136', array['B','B','B','B','B','C','C','B','B','B','B','B','B','B','B','B','B','B','B','B','B','B']),  -- UGWU Chidubem David  [sheet id "New01"]
  ('N703939826023', array['B','B','C','B','B','C','C','B','B','B','C','C','C','C','B','B','B','B','B','B','B','C']),  -- David Chiedozie  [sheet id "20016"]
  ('D703939825099', array['B','A','B','A','B','C','B','B','B','B','B','B','B','B','B','B','A','B','B','B','B','B']),  -- Chukwusom EZEANI
  ('L703939826012', array['A','A','B','A','A','B','B','A','A','A','B','A','B','A','A','A','A','A','A','B','A','A']),  -- Stephanie EZEWEPUTA
  ('Z703939825102', array['A','A','B','A','A','B','B','A','A','A','B','A','B','A','A','A','A','A','A','B','B','B']),  -- Chizitere HARFORD
  ('N703939825103', array['B','B','B','B','B','C','C','B','B','B','B','B','B','B','B','B','B','B','B','B','B','B']),  -- Jaden HARFORD
  ('Y703939825138', array['B','B','C','B','B','C','C','B','B','B','C','C','C','C','B','B','B','B','B','C','B','C']),  -- Kenenna NWABUEZE
  ('P703939825098', array['B','B','B','B','B','C','C','B','B','B','B','B','B','B','B','B','B','B','B','B','B','B']),  -- Chizobam NWANNA-ANUNASO
  ('R703939825082', array['C','C','D','C','C','E','D','C','C','C','D','D','D','D','D','C','C','C','C','D','C','D']),  -- Ifechuwku NWANZE
  ('D703939826015', array['A','A','A','A','A','A','B','A','A','A','A','A','A','A','A*','A','A','A','A','A','A','A']),  -- Chimamanda NWEKE
  ('Z703939825077', array['A','A','B','A','A','B','B','A','A','A','B','A','B','A','A','A','A','A','A','B','B','B']),  -- Divine Favour UGWUMGBOR
  ('P703939826014', array['A','A','B','A','B','B','B','A','A','A','B','B','B','B','A','A','A','A','A','B','B','B']),  -- Uchenna MADUAKOLAM
  ('C703939825081', array['C','D','E','D','D','E','E','C','C','D','D','E','D','E','E','D','D','D','D','D','D','E']),  -- Chidinma NWIFURU
  ('N703939825080', array['C','C','D','C','C','E','D','C','C','C','D','D','C','D','D','C','C','C','C','D','C','D']),  -- Onyedikachi Ezeani  [sheet id "Yr8Jan"]
  ('J703939825110', array['B','B','C','B','C','D','C','B','B','B','C','C','C','C','C','B','B','B','B','C','C','C']),  -- Prosper EZENWA
  ('C703939825079', array['A','A','B','A','A','B','B','A','A','A','A','A','B','A','A','A','A','A','A','A','A','A']),  -- Ifechukwu UGWU
  ('R703939826025', array['B','B','C','B','B','C','C','B','B','B','C','C','C','C','B','B','B','B','B','C','B','C']),  -- Sheila Aneke  [sheet id "New34"]
  ('W703939826020', array['B','B','C','B','B','C','C','B','B','B','C','B','C','B','B','B','B','B','B','B','B','C']),  -- Ikemsinachi EZE  [sheet id "New9"]
  ('E703939822170', array['A','A','B','A','B','B','B','A','A','B','B','B','B','B','A','B','A','A','B','B','B','B']),  -- Splendid NESTOR-EZEME  [sheet id "E703939822170-W1"]
  ('U703939822171', array['A','A','B','A','B','B','B','A','A','A','B','A','B','B','A','A','A','A','A','B','B','B']),  -- Treasure NESTOR-EZEME  [sheet id "NEW 2026"]
  ('Z703939826003', array['B','B','C','B','B','C','C','C','C','B','C','C','C','C','B','B','B','B','B','C','B','C']),  -- Onyekachukwu Nwachukwu  [sheet id "New35"]
  ('K703939825076', array['B','B','B','B','B','C','C','B','B','B','B','B','B','B','B','B','B','B','B','B','B','B']),  -- Kennedy OKOYE
  ('A703939826013', array['A','A','B','A','A','B','B','B','B','A','B','A','B','A','A','A','A','A','A','B','B','B']),  -- Chukwuma ONUORAH
  ('N703939825078', array['A','A','A','A','A','A','B','A','A','A','A','A','A','A','A','A','A','A','A','A','A','A']);  -- Ezinne UGWU

create temporary table cat4_targets_import on commit drop as
select c.upn, t.subject_name, t.target_grade
from cat4_sheet c,
     unnest(
       array[
    'Art', 'Biology', 'Economics', 'Chemistry',
    'Civics', 'Computing', 'Graphics', 'English',
    'English Lit', 'Food and Nutrition', 'French', 'Geography',
    'Igbo', 'History', 'Mathematics', 'PE',
    'Physics', 'Religion', 'Science', 'Sociology',
    'Spanish', 'Add Maths'
       ],
       c.grades
     ) as t(subject_name, target_grade);

-- Fail loudly rather than silently dropping rows: every UPN and subject name
-- must resolve, and every grade must be on the scale.
do $$
declare
  missing text;
begin
  select string_agg(distinct i.upn, ', ') into missing
  from cat4_targets_import i
  where not exists (select 1 from students s where s.upn = i.upn);
  if missing is not null then
    raise exception 'CAT4 target import: no student on roll with UPN(s): %', missing;
  end if;

  select string_agg(distinct i.subject_name, ', ') into missing
  from cat4_targets_import i
  where not exists (select 1 from subjects s where s.subject_name = i.subject_name);
  if missing is not null then
    raise exception 'CAT4 target import: unknown subject(s): %', missing;
  end if;

  select string_agg(distinct i.target_grade, ', ') into missing
  from cat4_targets_import i
  where not exists (select 1 from grade_scale g where g.grade = i.target_grade);
  if missing is not null then
    raise exception 'CAT4 target import: grade(s) not on grade_scale: %', missing;
  end if;
end $$;

insert into target_grades (student_id, subject_id, target_grade, is_demo)
select s.student_id, sub.subject_id, i.target_grade, false
from cat4_targets_import i
join students s on s.upn = i.upn
join subjects sub on sub.subject_name = i.subject_name
on conflict (student_id, subject_id) do nothing;

commit;
