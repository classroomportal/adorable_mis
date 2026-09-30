-- Migration 288: students tick homework off as done.
--
-- Why: the principal asked (30 Sept 2026, looking at the student Homework
-- page) for a box a student can tick to say a piece of homework is done, the
-- card then turning green and shrinking to just the subject. It is kept in
-- the database rather than the browser so it follows the student to any
-- device, and so the teacher can see it in the mark book.
--
-- It is the student's own note, not a hand-in and not a grade: it changes no
-- mark, and nothing in reporting reads it.
--
-- Now:
--   * homework_done: one row per student per homework they have ticked.
--     Unticking deletes the row.
--   * A student can tick and untick only their own, and only on homework
--     they can see (the homework table's rules: their class, while it is
--     set). done_at is stamped by the database.
--   * Readable by the student and by those who can see the homework's grades
--     (can_view_homework_marks(): the class's teachers, the HoD, SMT, admin).
--     Parents: nothing.
--   * my_homework() also returns done / done_at, so it is dropped and
--     recreated with the extra columns (same rules otherwise).

set local formwork.change_note = 'Principal (direct)';

create table if not exists public.homework_done (
  homework_id bigint not null references public.homework(homework_id) on delete cascade,
  student_id integer not null references public.students(student_id),
  done_at timestamptz not null default now(),
  primary key (homework_id, student_id)
);

comment on table public.homework_done is
  'Homework a student has ticked as done (migration 288). The student''s own note: not a hand-in or a grade.';

alter table public.homework_done enable row level security;
grant select, insert, delete on public.homework_done to authenticated;

create policy "Own homework ticks readable by the student"
  on public.homework_done for select to authenticated
  using (student_id = my_student_id());
create policy "Homework ticks readable by the class's teachers, HoD and SMT"
  on public.homework_done for select to authenticated
  using (can_view_homework_marks(homework_id));
create policy "Students tick their own homework"
  on public.homework_done for insert to authenticated
  with check (
    student_id = my_student_id()
    and exists (select 1 from homework h where h.homework_id = homework_done.homework_id and h.status = 'set'));
create policy "Students untick their own homework"
  on public.homework_done for delete to authenticated
  using (student_id = my_student_id());

-- The time is the database's, not the browser's.
create or replace function public.homework_done_stamp()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.done_at := now();
  return new;
end;
$$;

create trigger trg_homework_done_stamp before insert on public.homework_done
  for each row execute function public.homework_done_stamp();

drop function if exists public.my_homework(date, date);

create function public.my_homework(p_from date, p_to date)
returns table (
  homework_id bigint,
  class_id integer,
  class_code text,
  subject_name text,
  title text,
  instructions text,
  set_on date,
  due_on date,
  due_slot_id integer,
  due_period integer,
  scheme_name text,
  scheme_kind text,
  out_of numeric,
  teacher_name text,
  grade text,
  score numeric,
  mark_comment text,
  marked boolean,
  done boolean,
  done_at timestamptz
)
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
    and (h.class_id in (select sc.class_id from student_class sc where sc.student_id = v_student)
         or exists (select 1 from homework_marks m2 where m2.homework_id = h.homework_id and m2.student_id = v_student))
  order by h.due_on, t.period_number nulls last, h.homework_id;
end;
$$;

revoke execute on function public.my_homework(date, date) from public, anon;
grant execute on function public.my_homework(date, date) to authenticated;
