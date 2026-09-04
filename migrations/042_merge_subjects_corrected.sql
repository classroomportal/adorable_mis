-- ============================================
-- Migration 042: merge_subjects (corrected)
-- Captures the fix applied live via SQL editor on 2026-09-04, which was
-- never committed as a migration. Original version in migration 038 assumed
-- subject_id was uuid (it's integer) and only moved `results` — this
-- version also moves `classes`, `target_grades`, and
-- `subject_grade_boundaries` before deleting the duplicate subject row.
--
-- Use: select merge_subjects(<duplicate_subject_id>, <real_subject_id>);
-- ============================================

create or replace function merge_subjects(from_id integer, into_id integer)
returns void
language plpgsql
security definer
as $$
begin
  update classes set subject_id = into_id where subject_id = from_id;

  update results r
  set subject_id = into_id
  where r.subject_id = from_id
  and not exists (
    select 1 from results r2
    where r2.student_id = r.student_id
    and r2.week_start_date = r.week_start_date
    and r2.subject_id = into_id
  );
  delete from results where subject_id = from_id;

  update target_grades t
  set subject_id = into_id
  where t.subject_id = from_id
  and not exists (
    select 1 from target_grades t2
    where t2.student_id = t.student_id
    and t2.subject_id = into_id
  );
  delete from target_grades where subject_id = from_id;

  update subject_grade_boundaries b
  set subject_id = into_id
  where b.subject_id = from_id
  and not exists (
    select 1 from subject_grade_boundaries b2
    where b2.year_group = b.year_group
    and b2.grade = b.grade
    and b2.subject_id = into_id
  );
  delete from subject_grade_boundaries where subject_id = from_id;

  delete from subjects where subject_id = from_id;
end;
$$;
