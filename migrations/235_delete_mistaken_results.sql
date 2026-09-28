-- Migration 235: let whoever may enter a score delete one entered by mistake.
--
-- Why: a score saved against the wrong student (or the wrong result set, or
-- for a student who wasn't sitting the test) could be overwritten but never
-- removed. `results` had INSERT and UPDATE policies and grants, but no DELETE
-- policy and no DELETE grant, so there was no way back from a mistaken save
-- short of asking for it to be done in the SQL editor. Clearing the box on
-- /results/enter and saving silently kept the old score, because the upsert
-- only sends rows that have a score.
--
-- Who may delete is exactly who may write, with the same expressions as the
-- UPDATE policies (migrations 112 and 129): admins and assessment managers
-- (is_assessment_manager()), assessment users, and a class's teacher of
-- record for students in that class's subject (teaches_student_for_subject(),
-- which identifies the caller through auth.uid()). A teacher cannot delete
-- another teacher's scores.
--
-- Nothing is lost for good: trg_log_grade_change (migration 215) already
-- fires on DELETE and keeps the full deleted row, with who deleted it, in the
-- append-only grade_history, viewable at /assessments/grade-history.
-- No other table has a foreign key to results, so a delete touches nothing else.

grant delete on public.results to authenticated;

drop policy if exists assessment_delete_results on public.results;
create policy assessment_delete_results on public.results
  for delete to authenticated
  using (is_assessment_manager());

drop policy if exists assessment_user_delete_results on public.results;
create policy assessment_user_delete_results on public.results
  for delete to authenticated
  using (has_staff_role(array['assessment_user'::text]));

drop policy if exists teacher_delete_own_class_results on public.results;
create policy teacher_delete_own_class_results on public.results
  for delete to authenticated
  using (teaches_student_for_subject(student_id, subject_id));
