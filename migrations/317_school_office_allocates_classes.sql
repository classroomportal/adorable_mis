-- Migration 317: the school office can save class allocations.
--
-- Why (the principal, 2 Oct 2026, with a screenshot from sro@: "Office can't
-- save"): /admin/block-allocation is granted to school_office in
-- role_permissions, but the database's write rule on student_class,
-- can_allocate_classes(), still allowed only admin, head_of_department and
-- pastoral. The office could open the page and tick students, and every save
-- was refused with "new row violates row-level security policy for table
-- student_class" (five attempts from sro@ between 07:40 and 07:43 UTC).
--
-- can_allocate_classes() now includes school_office, matching the page grant.
-- It is used by student_class's write policy and by plan_student_class's
-- ("Plan enrolments edited by allocators"), so the office can also edit next
-- year's planned enrolments, as allocators can. Holders of school_office today:
-- admissions@, admissions1@, guardian.counselling@, pa2@, sro@, sro3@.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.can_allocate_classes()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select is_admin() or has_staff_role(array['head_of_department', 'pastoral', 'school_office']);
$$;
