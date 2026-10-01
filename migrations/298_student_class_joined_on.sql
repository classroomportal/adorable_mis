-- Migration 298: when a student joined a class, so a late joiner doesn't
-- inherit the class's earlier homework.
--
-- Why: when a student is added to a class (e.g. Munachi CHIBUEZE, Year 10,
-- who had no classes on 30 Sept 2026), they used to see every piece of the
-- class's homework from the start of the year, and anything from the last
-- four weeks showed as overdue in red. The principal agreed (1 Oct 2026) that
-- a late joiner simply doesn't see homework that was due before they joined.
--
--   * student_class.joined_on: the day the student was put in the class.
--     New enrolments get the school day they are added (school_today()).
--     Existing enrolments are dated the first day of the current academic
--     year (1 Sept 2026), so nobody already in a class loses anything.
--   * my_homework() and the students' read policy on homework leave out
--     homework due before the student joined the class, unless the student
--     already has a mark for it (marks are never hidden).
--   * The mark book and mark sheet (pages) leave a student out of homework
--     due before they joined.

set local formwork.change_note = 'Principal (direct)';

alter table public.student_class add column if not exists joined_on date;
update public.student_class set joined_on = coalesce(
  (select start_date from public.academic_years where status = 'current'), date '2026-09-01')
where joined_on is null;
alter table public.student_class alter column joined_on set default school_today();
alter table public.student_class alter column joined_on set not null;

drop policy if exists "Homework readable by students in the class" on public.homework;
create policy "Homework readable by students in the class"
  on public.homework for select to authenticated
  using (status = 'set' and exists (
    select 1 from student_class sc
    where sc.class_id = homework.class_id
      and sc.student_id = my_student_id()
      and homework.due_on >= sc.joined_on));

create or replace function public.my_homework(p_from date, p_to date)
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
declare
  v_student integer := my_student_id();
begin
  if v_student is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 120 then
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
  left join homework_marks m on m.homework_id = h.homework_id and m.student_id = v_student and h.marks_released
  left join homework_done d on d.homework_id = h.homework_id and d.student_id = v_student
  where h.status = 'set'
    and h.due_on between p_from and p_to
    and (exists (select 1 from student_class sc
                 where sc.class_id = h.class_id and sc.student_id = v_student
                   and h.due_on >= sc.joined_on)
         or exists (select 1 from homework_marks m2 where m2.homework_id = h.homework_id and m2.student_id = v_student))
  order by h.due_on, t.period_number nulls last, h.homework_id;
end;
$$;

revoke execute on function public.my_homework(date, date) from public, anon;
grant execute on function public.my_homework(date, date) to authenticated;
