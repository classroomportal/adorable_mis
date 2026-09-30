-- Migration 270: a student's gender is required, and is 'M' or 'F'.
--
-- Why: the principal asked (30 Sept 2026) for gender to be compulsory for
-- new students and chosen from a drop-down. It was free text: 9 students
-- admitted on 14 Sept 2026 had none (filled in that day from their
-- single-sex boarding houses), and 19 said 'Male', 'Female' or 'Female '
-- rather than M / F, which every count by gender had to work around.
--
-- Every student (active and left) now has a gender, so the column can be
-- NOT NULL with a check, which also stops it being blanked on an edit or
-- a CSV re-import. The New Student page and the student record offer
-- Male / Female (lib/studentFields.js STUDENT_GENDERS); the CSV import
-- converts Male/Female to M/F and refuses a new student without one.
-- No database function reads gender except student_core_fields().

set local formwork.change_note = 'Principal (direct)';

update public.students
   set gender = upper(left(btrim(gender), 1))
 where gender is distinct from upper(left(btrim(gender), 1))
   and btrim(gender) ~* '^(m|male|f|female)$';

alter table public.students alter column gender set not null;
alter table public.students add constraint students_gender_check check (gender in ('M', 'F'));

comment on column public.students.gender is 'M or F; required (migration 270).';
