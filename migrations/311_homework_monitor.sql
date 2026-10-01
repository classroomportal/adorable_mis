-- Migration 311: Homework Monitor for SMT.
--
-- Why (the principal, 1 Oct 2026): "We need a tile for smt to monitor what
-- homework is being set in the view like the students and to be able to
-- choose an individual timetable and overall by year." The page
-- (/homework/monitor, a tile on the staff dashboard) shows a whole year
-- group's week of homework on the students' cards, and one chosen student's
-- week (their timetable with homework on it, and their Homework cards)
-- exactly as that student sees it.
--
-- The year view reads homework the way any member of staff can. The student
-- view needs the student's own Done ticks and released marks, so it goes
-- through homework_as_student(), which applies my_homework()'s rules (current
-- academic year, released marks only, homework due before the student joined
-- the class left out unless already marked) to the chosen student instead of
-- the signed-in one. It checks the caller holds /homework/monitor (SMT, and
-- admin through has_resource_access()) and returns nothing otherwise; SMT can
-- already read these marks and ticks through can_view_homework_marks().

set local formwork.change_note = 'Principal (direct)';

insert into public.resources (resource_key, label, section, sort_order)
values ('/homework/monitor', 'Homework Monitor', 'Students', 17)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('smt', '/homework/monitor')
on conflict do nothing;

create or replace function public.homework_as_student(p_student_id integer, p_from date, p_to date)
returns table (
  homework_id bigint, class_id integer, class_code text, subject_name text, title text,
  instructions text, set_on date, due_on date, due_slot_id integer, due_period integer,
  scheme_name text, scheme_kind text, out_of numeric, teacher_name text, grade text,
  score numeric, mark_comment text, marked boolean, done boolean, done_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
begin
  if not has_resource_access('/homework/monitor') then
    return;
  end if;
  if p_student_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 120 then
    return;
  end if;

  return query
  select h.homework_id, h.class_id, h.class_code,
         coalesce(sub.display_name, sub.subject_name),
         h.title, h.instructions, h.set_on, h.due_on, h.due_slot_id, t.period_number,
         sch.name, sch.kind, coalesce(h.out_of, sch.fixed_max),
         nullif(btrim(coalesce(st.first_name, '') || ' ' || coalesce(st.last_name, '')), ''),
         m.grade, m.score, m.comment, (m.homework_id is not null),
         (d.homework_id is not null), d.done_at
  from homework h
  join academic_years y on y.academic_year_id = h.academic_year_id and y.status = 'current'
  join homework_schemes sch on sch.scheme_id = h.scheme_id
  left join subjects sub on sub.subject_id = h.subject_id
  left join staff st on st.staff_id = h.set_by_staff_id
  left join timetable_slots t on t.slot_id = h.due_slot_id
  left join homework_marks m on m.homework_id = h.homework_id and m.student_id = p_student_id and h.marks_released
  left join homework_done d on d.homework_id = h.homework_id and d.student_id = p_student_id
  where h.status = 'set'
    and h.due_on between p_from and p_to
    and (exists (select 1 from student_class sc
                 where sc.class_id = h.class_id and sc.student_id = p_student_id
                   and h.due_on >= sc.joined_on)
         or exists (select 1 from homework_marks m2 where m2.homework_id = h.homework_id and m2.student_id = p_student_id))
  order by h.due_on, t.period_number nulls last, h.homework_id;
end;
$$;
revoke execute on function public.homework_as_student(integer, date, date) from public, anon;
grant execute on function public.homework_as_student(integer, date, date) to authenticated;
