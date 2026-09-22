-- Migration 129: let a class's teacher of record save scores on /results/enter.
--
-- Why: Maurice Ekpo (staff 133, HoD Biology — roles teacher, smt, mentor)
-- hit "new row violates row-level security policy for table results" when
-- pressing Save all on /results/enter. He is not the only one; every
-- classroom teacher has been in the same position since the page shipped.
--
-- The page has always been reachable by teachers — role_permissions grants
-- '/results/enter' to teacher, smt, head_of_department and others, and the
-- page deliberately lists only classes where classes.staff_id is the signed-in
-- user. But the `results` table's write policies were never widened to match:
-- INSERT/UPDATE were limited to is_assessment_manager() (admin or
-- assessment_manager) and has_staff_role('assessment_user'). So the UI let
-- teachers type a full set of scores and then threw the raw Postgres RLS
-- error at them on save, with the work still on screen and nowhere to go.
--
-- The fix is not to hand every staff member write access to `results`. The
-- meaningful boundary is the one the page already draws: you may write a
-- result for a student only if you are the teacher of record for a class in
-- that subject that the student is actually enrolled in. That is narrower
-- than the `teacher` role (a teacher cannot touch another teacher's set) and
-- it also covers heads of department and SMT who teach, without giving the
-- rest of their role anything.
--
-- Note this is an upsert (`onConflict: student_id,subject_id,
-- result_set_event_id`), so both INSERT and UPDATE are needed: re-saving a
-- class after correcting one score takes the UPDATE path.

-- The one place the "is this my class's student" rule lives, so widening or
-- narrowing it later is a single function change rather than a policy sweep.
-- SECURITY DEFINER because `classes` and `student_class` are themselves
-- RLS-protected; the caller is identified by auth.uid() inside, never passed in.
create or replace function teaches_student_for_subject(p_student_id integer, p_subject_id integer)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from profiles p
    join classes c on c.staff_id = p.staff_id
    join student_class sc on sc.class_id = c.class_id
    where p.id = auth.uid()
      and p.staff_id is not null
      and c.subject_id = p_subject_id
      and sc.student_id = p_student_id
  );
$$;

grant execute on function teaches_student_for_subject(integer, integer) to authenticated;

-- The policy checks run once per row saved, so the lookup wants an index on
-- the teacher side of `classes`; student_class is already keyed on
-- (student_id, class_id) by its primary key.
create index if not exists idx_classes_staff_subject
  on classes (staff_id, subject_id);

create policy teacher_insert_own_class_results on results
  for insert with check (teaches_student_for_subject(student_id, subject_id));

-- WITH CHECK as well as USING, and deliberately the same expression: without
-- it a teacher could update a row they legitimately own into pointing at some
-- other student or subject.
create policy teacher_update_own_class_results on results
  for update
  using (teaches_student_for_subject(student_id, subject_id))
  with check (teaches_student_for_subject(student_id, subject_id));
