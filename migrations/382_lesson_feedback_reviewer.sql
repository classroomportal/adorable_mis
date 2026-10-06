-- Migration 382: a Lesson Feedback Reviewer role.
--
-- Why: the principal, 6 Oct 2026: someone other than SMT needs to look at
-- lesson feedback for the whole school, enough to tell which class a concern
-- is in and take it up with the Head of Department or SMT, but never which
-- student said it. So the role gets:
--   * the summary for every class, as SMT do (lesson_feedback_summary(), the
--     3-response rule unchanged);
--   * the individual responses SMT see, without the student's name or year:
--     lesson date and period, class, subject, teacher, green/amber/red and the
--     answers, through lesson_feedback_responses() below.
-- It does not get a select policy on lesson_feedback or its answers: those
-- rows carry student_id, and only SMT read them (migration 365).
--
-- lesson_feedback_responses() is also what the page now uses for SMT, so the
-- two see the same list, grouped by subject; for SMT (has_staff_role, so admin
-- alone is not enough) it adds the student's name and year. Anyone else gets
-- nothing from it.

set local formwork.change_note = 'Principal (direct)';

insert into public.roles (role_name, description) values
  ('lesson_feedback_reviewer', 'Sees lesson feedback for every class, and the individual responses without students'' names, to follow up with Heads of Department or SMT (migration 382).')
on conflict (role_name) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('lesson_feedback_reviewer', '/lesson-feedback')
on conflict do nothing;

-- ---- Summary: every class for SMT and the reviewer --------------------------

create or replace function public.lesson_feedback_summary(p_from date, p_to date)
returns table (class_id integer, class_code text, subject_name text, year_group integer,
               teacher_name text, staff_id integer, responses integer,
               green integer, amber integer, red integer, questions jsonb)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_staff integer;
  v_all boolean := has_staff_role(array['smt', 'lesson_feedback_reviewer']);
  v_dept text;
begin
  select p.staff_id into v_staff from profiles p where p.id = auth.uid();
  if v_staff is null and not v_all then
    return;
  end if;
  select sr.scope_value into v_dept
  from staff_roles sr
  where sr.staff_id = v_staff and sr.role_name = 'head_of_department' and sr.scope_type = 'department'
  limit 1;

  return query
  with mine as (
    select f.*
    from lesson_feedback f
    join subjects sub on sub.subject_id = f.subject_id
    where f.lesson_date between p_from and p_to
      and (v_all or f.staff_id = v_staff or (v_dept is not null and sub.department_name = v_dept))
  ),
  per_class as (
    select m.class_id, m.staff_id, count(*)::integer as responses,
           count(*) filter (where m.understanding = 'green')::integer as green,
           count(*) filter (where m.understanding = 'amber')::integer as amber,
           count(*) filter (where m.understanding = 'red')::integer as red
    from mine m
    group by m.class_id, m.staff_id
  ),
  per_question as (
    select m.class_id, m.staff_id,
           jsonb_agg(jsonb_build_object(
             'question_id', q.question_id, 'question', q.question, 'good_answer', q.good_answer,
             'yes', q.yes, 'no', q.no) order by q.position, q.question_id) as questions
    from (select distinct class_id, staff_id from mine) m
    cross join lateral (
      select lq.question_id, lq.question, lq.good_answer, lq.position,
             count(*) filter (where a.answer)::integer as yes,
             count(*) filter (where not a.answer)::integer as no
      from mine m2
      join lesson_feedback_answers a on a.feedback_id = m2.feedback_id
      join lesson_feedback_questions lq on lq.question_id = a.question_id
      where m2.class_id = m.class_id and m2.staff_id is not distinct from m.staff_id
      group by lq.question_id, lq.question, lq.good_answer, lq.position
    ) q
    group by m.class_id, m.staff_id
  )
  select pc.class_id, c.class_code, coalesce(sub.display_name, sub.subject_name), c.year_group,
         case when s.staff_id is null then null else s.first_name || ' ' || s.last_name end,
         pc.staff_id, pc.responses,
         case when pc.responses >= 3 then pc.green end,
         case when pc.responses >= 3 then pc.amber end,
         case when pc.responses >= 3 then pc.red end,
         case when pc.responses >= 3 then pq.questions end
  from per_class pc
  join classes c on c.class_id = pc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  left join staff s on s.staff_id = pc.staff_id
  left join per_question pq on pq.class_id = pc.class_id and pq.staff_id is not distinct from pc.staff_id
  order by c.year_group, c.class_code, 5;
end;
$$;

-- ---- Individual responses: names for SMT only --------------------------------

-- One row per response in the dates chosen, by subject, class, then newest
-- lesson first. p_red_only: only responses that were red (the page's default).
-- answers: [{question_id, answer}]. student_name and student_year are filled
-- in only for SMT. No feedback_id or time sent, so the reviewer can't match a
-- response to the order students tapped. At most 2000 rows.
create or replace function public.lesson_feedback_responses(p_from date, p_to date, p_red_only boolean default true)
returns table (subject_name text, department_name text, class_id integer, class_code text,
               lesson_date date, period_number integer, teacher_name text,
               understanding text, answers jsonb, student_name text, student_year integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_smt boolean := has_staff_role(array['smt']);
begin
  if not (v_smt or has_staff_role(array['lesson_feedback_reviewer'])) then
    return;
  end if;

  return query
  select coalesce(sub.display_name, sub.subject_name), sub.department_name,
         f.class_id, c.class_code, f.lesson_date, f.period_number,
         case when s.staff_id is null then null else s.first_name || ' ' || s.last_name end,
         f.understanding,
         coalesce((select jsonb_agg(jsonb_build_object('question_id', a.question_id, 'answer', a.answer)
                                    order by a.question_id)
                   from lesson_feedback_answers a where a.feedback_id = f.feedback_id), '[]'::jsonb),
         case when v_smt then st.first_name || ' ' || st.last_name end,
         case when v_smt then st.year_group end
  from lesson_feedback f
  join classes c on c.class_id = f.class_id
  join subjects sub on sub.subject_id = f.subject_id
  join students st on st.student_id = f.student_id
  left join staff s on s.staff_id = f.staff_id
  where f.lesson_date between p_from and p_to
    and (not coalesce(p_red_only, true) or f.understanding = 'red')
  order by 1, c.class_code, f.lesson_date desc, f.period_number,
           case f.understanding when 'red' then 0 when 'amber' then 1 else 2 end
  limit 2000;
end;
$$;

revoke execute on function public.lesson_feedback_responses(date, date, boolean) from public, anon;
grant execute on function public.lesson_feedback_responses(date, date, boolean) to authenticated;
