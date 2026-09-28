-- Migration 236: narrow who may delete a score to the school's rule.
--
-- Why: migration 235 let anyone who could write a score delete it, which
-- included assessment users deleting any score in the school. The principal's
-- rule (28 Sept 2026):
--   * a teacher may delete only their own scores, i.e. scores for students in
--     a class they are the teacher of record for (the class teacher is the
--     person who enters its scores) — teaches_student_for_subject(), the same
--     test that lets them enter the score (migration 129);
--   * a Head of Department may also delete any score in their department's
--     subjects;
--   * assessment managers (and admins, which is_assessment_manager() already
--     includes) may delete any score.
-- Assessment users are no longer able to delete scores unless one of those
-- applies to them.
--
-- A Head of Department's department comes from staff_roles (role
-- head_of_department, scope_type 'department', scope_value) matched against
-- subjects.department_name, the same source as my_department_scope(), but
-- every such row counts, not just the first. A subject with no department
-- (3 on 28 Sept) is deletable only by its class teacher or an assessment
-- manager.
--
-- An earlier draft of this migration, applied live briefly on 28 Sept, keyed
-- "own" on results.staff_id and added a trigger stamping it from the sign-in.
-- The rule is about the class, not the row, so that trigger is removed here.

drop trigger if exists trg_stamp_result_staff on public.results;
drop function if exists public.stamp_result_staff();
drop policy if exists delete_own_department_or_any_results on public.results;
drop function if exists public.can_delete_result(integer, integer);

-- SECURITY DEFINER because the profiles and staff_roles lookups must not
-- depend on the caller's own read access; the caller is identified by
-- auth.uid() inside, and the arguments are only the row being deleted.
create or replace function public.can_delete_result(p_student_id integer, p_subject_id integer)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select is_assessment_manager()
    or teaches_student_for_subject(p_student_id, p_subject_id)
    or exists (
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

grant execute on function public.can_delete_result(integer, integer) to authenticated;

drop policy if exists assessment_delete_results on public.results;
drop policy if exists assessment_user_delete_results on public.results;
drop policy if exists teacher_delete_own_class_results on public.results;

create policy delete_own_class_department_or_any_results on public.results
  for delete to authenticated
  using (can_delete_result(student_id, subject_id));
