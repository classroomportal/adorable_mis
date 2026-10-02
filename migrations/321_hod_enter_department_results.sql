-- Migration 321: Heads of Department may enter and change scores in their
-- department's subjects.
--
-- Why: the principal, 2 Oct 2026. A Head of Department needs to enter results
-- for classes in their department (for example when a colleague is away), but
-- the results write policies only allowed the class teacher
-- (teaches_student_for_subject(), migration 129), assessment users and
-- assessment managers. Migration 236 already let a Head of Department delete
-- any score in their department; this lets them insert and update too, under
-- the same department rule.
--
-- A Head of Department's department is every staff_roles row with role
-- head_of_department, scope_type 'department', whose scope_value matches
-- subjects.department_name: the same test as can_delete_result(). A subject
-- with no department stays with its class teacher and the assessment staff.
-- Who entered a score is still recorded in grade_history from auth.uid()
-- (migration 215), whatever results.staff_id the page sends.

create or replace function public.is_hod_for_subject(p_subject_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    join subjects s on s.department_name = sr.scope_value
    where p.id = auth.uid()
      and sr.role_name = 'head_of_department'
      and sr.scope_type = 'department'
      and s.subject_id = p_subject_id
  );
$$;

revoke execute on function public.is_hod_for_subject(integer) from public, anon;
grant execute on function public.is_hod_for_subject(integer) to authenticated;

drop policy if exists hod_insert_department_results on public.results;
create policy hod_insert_department_results on public.results
  for insert to authenticated
  with check (public.is_hod_for_subject(subject_id));

drop policy if exists hod_update_department_results on public.results;
create policy hod_update_department_results on public.results
  for update to authenticated
  using (public.is_hod_for_subject(subject_id))
  with check (public.is_hod_for_subject(subject_id));
