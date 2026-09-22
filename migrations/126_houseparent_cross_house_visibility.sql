-- Migration 126: let a houseparent who also works across the school widen
-- their student view beyond their own boarding house.
--
-- Why: houseparent scoping (sql/071_house_scope.sql) narrows /students and
-- /behaviour to the viewer's own house. Nearly every houseparent here also
-- teaches, mentors or runs a department during the day, and the narrowing left
-- them unable to look up — or log behaviour for — a student they had just
-- taught in a lesson. Their house is still the right *default* for pastoral
-- work, so this keeps it as a default rather than dropping it: staff whose
-- only student-facing job is the house stay locked to it exactly as before,
-- and everyone else gets a "Whole school" switch in the app.
--
-- Worth being explicit that this was never a security boundary. RLS on
-- `students` is `staff_read_students` USING (is_staff_or_admin()), so every
-- member of staff could always read every student row; the house scope is a UI
-- narrowing and these functions only decide how far that narrowing goes. Do
-- not read this migration as loosening a permission — it loosens a filter.

-- True only for staff whose entire student-facing job is their boarding house.
-- Those people keep the locked, house-only view.
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
    select 1
    from profiles p
    join students s on s.mentor_staff_id = p.staff_id
    where p.id = auth.uid()
  );
$$;

-- One round trip for the pages that need both answers: which house (null when
-- unscoped) and whether that house is the only thing the viewer may see.
create or replace function my_house_access()
returns jsonb
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'house', my_house_scope(),
    'exclusive', coalesce(my_house_scope_is_exclusive(), false)
  );
$$;

grant execute on function my_house_scope_is_exclusive() to authenticated;
grant execute on function my_house_access() to authenticated;
