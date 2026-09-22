-- Migration 127: resolve a mentor's mentees through the Mentor-block classes,
-- which is where the relationship actually lives.
--
-- Why: `students.mentor_staff_id` is NULL for all 274 active students and has
-- never been populated. The real mentor link is a class in the `Mentor`
-- curriculum block joined to its students through `student_class` — 29 such
-- classes, all with a `staff_id`, 29 distinct mentors, covering every active
-- student, each mapping 1:1 onto a form class. /behaviour already reads it
-- that way; /reports/write-pastoral-comments did not.
--
-- The consequence was a silent dead end: that page decided whether to offer
-- the "Mentor" comment type by counting students with
-- `mentor_staff_id = <me>`, which is always 0, so the option never appeared
-- for anyone and no mentor could write a mentor report comment. Nobody had
-- hit it yet because no pastoral comments had been written at all, but
-- "Y7 Settling in" is due 12 October 2026.
--
-- Fixing the read rather than backfilling the column keeps one source of
-- truth: class allocation already moves students between mentors, and a
-- backfilled column would need a trigger to chase it. `mentor_staff_id` is
-- left in place but stays unused — it can be dropped once nothing references
-- it.

create or replace function my_mentee_ids()
returns setof integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select distinct sc.student_id
  from profiles p
  join classes c on c.staff_id = p.staff_id
  join curriculum_blocks b on b.block_id = c.block_id and b.block_name = 'Mentor'
  join student_class sc on sc.class_id = c.class_id
  where p.id = auth.uid();
$$;

grant execute on function my_mentee_ids() to authenticated;

-- Migration 126 tested mentoring via students.mentor_staff_id when deciding
-- whether a houseparent also works across the school. That check could never
-- fire, for the reason above. Point it at the real relationship. No houseparent
-- changes state today (all seven are already widened by their timetabled
-- classes), but a future houseparent who only mentors would have been missed.
create or replace function my_house_scope_is_exclusive()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name = 'houseparent'
      and sr.scope_type = 'house'
  )
  and not exists (
    -- Any second role that means day-to-day contact with students from other
    -- houses. `bursar` and `tuckshop` are deliberately left out: they are not
    -- teaching roles and do not on their own justify widening a pastoral view.
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name in (
        'admin', 'smt', 'hr', 'pastoral', 'teacher', 'head_of_department',
        'mentor', 'assessment_manager', 'assessment_user', 'school_office',
        'admissions'
      )
  )
  and not exists (
    -- staff_roles rows are patchy in the live data (several people who clearly
    -- teach have no `teacher` row), so an actual timetabled class counts too.
    select 1
    from profiles p
    join classes c on c.staff_id = p.staff_id
    where p.id = auth.uid()
  )
  and not exists (
    -- Same for mentoring: a mentor group crosses houses by design.
    select 1 from my_mentee_ids()
  );
$$;
