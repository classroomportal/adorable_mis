-- Migration 431: a one-class worksheet follows the current timetable.
--
-- Why: the principal, 10 Oct 2026, asked what happens when a Nova-T import
-- moves a lesson. The importer deletes a class's lessons and adds them again,
-- so a worksheet added to one class's lesson (migration 428) kept the date,
-- period and opening time it was given at upload. If the lesson moved, the
-- worksheet dropped off the student's timetable and the teacher's panel, and
-- still opened at the old time, which could be before the new lesson.
-- (Whole-year worksheets, migration 430, already work the lesson out when
-- read, so they follow a move.)
--
-- Now a one-class worksheet opens at class_lesson_start(): the start of that
-- class's lesson on that date in that period on the current timetable, in
-- term and not on a holiday. If there is no such lesson any more, it stays
-- locked to students, and the teacher's panel lists it as moved so it can be
-- removed and added again. opens_at is kept as the time at upload, for the
-- record; nothing decides access by it any more.

set local formwork.change_note = 'Principal (direct)';

-- The start of the class's lesson on that date in that period, from the
-- current timetable, or null if there isn't one.
create or replace function public.class_lesson_start(p_class_id integer, p_date date, p_period integer)
returns timestamp
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select cl.lesson_date + cl.start_time
  from class_lessons_between(p_class_id, p_date, p_date) cl
  where cl.period_number = p_period
  limit 1;
$$;

revoke execute on function public.class_lesson_start(integer, date, integer) from public, anon;
grant execute on function public.class_lesson_start(integer, date, integer) to authenticated;

comment on column public.lesson_worksheets.opens_at is
  'One-class worksheets: the lesson''s start when it was uploaded, kept for the record. Access follows the current timetable through class_lesson_start() (migration 431).';

alter policy lesson_worksheets_student_read on public.lesson_worksheets
  using (
    case when class_id is not null then
      class_lesson_start(class_id, lesson_date, period_number) <= school_now()
      and exists (
        select 1 from student_class sc
        where sc.student_id = (select my_student_id())
          and sc.class_id = lesson_worksheets.class_id
          and coalesce(sc.joined_on, lesson_worksheets.lesson_date) <= lesson_worksheets.lesson_date)
    else
      (select my_student_id()) is not null
      and year_worksheet_open_for_me(subject_id, year_group, week_start, lesson_number)
    end);

-- As migration 430, with one-class worksheets timed from the current
-- timetable and left out when their lesson no longer exists.
create or replace function public.my_lesson_worksheets(p_from date, p_to date)
returns table (worksheet_id bigint, class_id integer, lesson_date date, period_number integer,
               opens_at timestamp, is_open boolean, title text, storage_path text, size_bytes bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with placed as (
    select w.worksheet_id, w.class_id, w.lesson_date, w.period_number,
           class_lesson_start(w.class_id, w.lesson_date, w.period_number) as opens_at,
           w.title, w.storage_path, w.size_bytes
    from lesson_worksheets w
    join student_class sc on sc.class_id = w.class_id and sc.student_id = my_student_id()
    where w.class_id is not null
      and w.lesson_date between p_from and least(p_to, p_from + 62)
      and coalesce(sc.joined_on, w.lesson_date) <= w.lesson_date
    union all
    select w.worksheet_id, c.class_id, l.lesson_date, l.period_number, l.starts_at,
           w.title, w.storage_path, w.size_bytes
    from student_class sc
    join classes c on c.class_id = sc.class_id
    join lesson_worksheets w on w.subject_id = c.subject_id and w.year_group = c.year_group
    cross join lateral class_nth_lesson(c.class_id, w.week_start, w.lesson_number) l
    where sc.student_id = my_student_id()
      and w.week_start between date_trunc('week', p_from)::date and least(p_to, p_from + 62)
      and l.lesson_date between p_from and least(p_to, p_from + 62)
      and coalesce(sc.joined_on, l.lesson_date) <= l.lesson_date
  )
  select p.worksheet_id, p.class_id, p.lesson_date, p.period_number, p.opens_at,
         p.opens_at <= school_now(),
         case when p.opens_at <= school_now() then p.title end,
         case when p.opens_at <= school_now() then p.storage_path end,
         case when p.opens_at <= school_now() then p.size_bytes end
  from placed p
  where p.opens_at is not null
  order by p.lesson_date, p.period_number, p.worksheet_id;
$$;
