-- Migration 183: Year 7 core data matches the forms pupils are taught in.
--
-- Why: the school's rule is that a pupil's form in core data
-- (students.form_class) decides their mentor group and class block — 7A
-- pupils are in 7A/Me and the 7A1 classes, and the same for 7C, 7G and 7L.
-- When the new 7L form was created, 11 pupils were moved into 7L/Me and the
-- 7L1 classes but their core data still said 7A, 7C or 7G. The school
-- confirmed on 26 Sep 2026 that those 11 are 7L pupils. One 7C pupil
-- (student 297) had no mentor group or class block at all, only set Maths.
--
-- 1. The 7L form was spelt "7 Loius"; the school spells it "7 Louis".
--    Nothing else stores the name (checked every text column): only
--    mentor_groups.group_name and one pupil's form_class.
-- 2. Every active pupil in 7L/Me gets form_class '7 Louis' (12 pupils: the
--    11 plus the one already there). trg_sync_mentor_group_from_form_class
--    sets their mentor_group_id to the 7L group from the new name.
-- 3. Student 297 joins 7C/Me and all fifteen 7C1 classes (16 enrolments). block_id and is_compound
--    are filled in by trg_set_student_class_block_id.
--
-- Checks its own counts and rolls back if they are not what was expected.

-- 1.
do $$
declare
  n integer;
begin
  update mentor_groups set group_name = '7 Louis' where group_name = '7 Loius' and year_group = 7;
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'expected to rename 1 mentor group, matched %', n;
  end if;
end $$;

-- 2.
do $$
declare
  n integer;
begin
  update students s
     set form_class = '7 Louis'
   where s.status = 'active'
     and s.year_group = 7
     and exists (select 1 from student_class x
                   join classes c on c.class_id = x.class_id
                  where x.student_id = s.student_id
                    and c.class_code = '7L/Me');
  get diagnostics n = row_count;
  if n <> 12 then
    raise exception 'expected to set 12 pupils to 7 Louis, matched %', n;
  end if;
  if exists (select 1 from students s
               join student_class x on x.student_id = s.student_id
               join classes c on c.class_id = x.class_id
              where c.class_code = '7L/Me'
                and s.status = 'active'
                and s.mentor_group_id is distinct from (select mentor_group_id from mentor_groups where group_name = '7 Louis')) then
    raise exception 'a 7L pupil did not get the 7 Louis mentor group';
  end if;
end $$;

-- 3.
do $$
declare
  n integer;
begin
  insert into student_class (student_id, class_id)
  select 297, c.class_id
    from classes c
   where (c.class_code = '7C/Me' or c.class_code like '7C1/%')
     and exists (select 1 from students where student_id = 297 and year_group = 7 and form_class = '7 Charlotte' and status = 'active')
  on conflict (student_id, class_id) do nothing;
  get diagnostics n = row_count;
  if n <> 16 then
    raise exception 'expected to add student 297 to 16 classes (7C/Me + 15 7C1), added %', n;
  end if;
end $$;
