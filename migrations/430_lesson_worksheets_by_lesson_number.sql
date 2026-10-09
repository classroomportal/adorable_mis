-- Migration 430: a worksheet for a whole year group, on a numbered lesson of
-- the week; the trial switch goes by subject.
--
-- Why: the principal, 9 Oct 2026: the Maths department wants every class in a
-- year to have the same worksheet at the same point, so a worksheet is
-- allocated to "Year 10 Mathematics, week of 12 Oct, lesson 3" rather than
-- uploaded class by class. Science and IT will want it too.
--
-- Now:
--   * lesson_worksheets has two kinds of row. A lesson worksheet (migration
--     428) has class_id, lesson_date, period_number and opens_at. A year
--     worksheet has subject_id, year_group, week_start (a Monday) and
--     lesson_number instead, and appears on every class of that subject and
--     year (classes.year_group) at the class's own lesson of that number.
--   * Lessons are numbered within the Monday–Friday week in time order, from
--     the class's timetable, counting only days in term and not holidays
--     (class_lessons_between()), so a holiday Monday makes Wednesday's lesson
--     lesson 1. A double lesson counts as two. Nothing is stored per class:
--     it is worked out when read, so a Nova-T re-import or a new class picks
--     it up.
--   * It opens to a class's students at the start of that class's lesson.
--     Maths classes in a year are timetabled together, so for Maths that is
--     the same moment; Science classes in a year are not, so each opens at
--     its own lesson. A class with fewer lessons that week doesn't get it
--     (12S/Ma has 1 lesson a week); the teacher's panel says which.
--   * Students read a year worksheet only through year_worksheet_open_for_me()
--     (in their select policy): a class of theirs, joined by that lesson's
--     date, whose lesson has started. The bucket's read rule still goes
--     through the row, so the file is locked the same way.
--   * Who adds and removes a year worksheet: can_add_year_worksheet(), anyone
--     who teaches or leads a class of that subject and year (class or lesson
--     teacher, Head of Department, admin), for a subject on the trial. Files
--     are under 's<subject_id>-y<year_group>/…' in the bucket.
--   * The trial switch is now lesson_worksheet_subjects, because there is no
--     IT department (ICT, Computing and the other digital subjects are in
--     Creative with Art and Music) and Science includes PE and Sports. Seeded
--     with the Maths department's subjects, which is what 428's department
--     switch covered. lesson_worksheet_departments is no longer read; it is
--     left in place because the Supabase connector holds back drop table
--     (drop it from the SQL editor if wanted). Policies are changed with
--     alter policy for the same reason. No worksheets had been added yet.

set local formwork.change_note = 'Principal (direct)';

-- 1. The switch, by subject ----------------------------------------------------------

create table public.lesson_worksheet_subjects (
  subject_id integer primary key references public.subjects(subject_id),
  added_at timestamptz not null default now()
);

alter table public.lesson_worksheet_subjects enable row level security;
grant select on public.lesson_worksheet_subjects to authenticated;

create policy lesson_worksheet_subjects_read on public.lesson_worksheet_subjects
  for select to authenticated using (true);

insert into public.lesson_worksheet_subjects (subject_id)
select s.subject_id from subjects s
join lesson_worksheet_departments d on d.department_name = s.department_name;

create or replace function public.can_add_lesson_worksheet(p_class_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_class_id is not null
    and exists (
      select 1 from classes c
      join lesson_worksheet_subjects ws on ws.subject_id = c.subject_id
      where c.class_id = p_class_id)
    and teaches_or_leads_class(p_class_id, null);
$$;

comment on table public.lesson_worksheet_departments is
  'No longer used (migration 430): the lesson worksheet trial is switched on by subject in lesson_worksheet_subjects.';

create or replace function public.can_add_year_worksheet(p_subject_id integer, p_year_group integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_subject_id is not null and p_year_group is not null
    and exists (select 1 from lesson_worksheet_subjects ws where ws.subject_id = p_subject_id)
    and (is_admin()
      or teaches_or_leads_class(null, p_subject_id) and exists (
        -- Head of Department for the subject (teaches_or_leads_class with
        -- only a subject checks just that), with a class in that year.
        select 1 from classes c where c.subject_id = p_subject_id and c.year_group = p_year_group)
      or exists (
        select 1 from classes c
        where c.subject_id = p_subject_id and c.year_group = p_year_group
          and teaches_or_leads_class(c.class_id, null)));
$$;

revoke execute on function public.can_add_year_worksheet(integer, integer) from public, anon;
grant execute on function public.can_add_year_worksheet(integer, integer) to authenticated;

-- 2. Numbered lessons ------------------------------------------------------------------

-- A class's lessons between two dates, each numbered within its Monday–Friday
-- week (lessons_in_week = how many that week).
create or replace function public.class_week_lessons(p_class_id integer, p_from date, p_to date)
returns table (lesson_date date, period_number integer, start_time time, end_time time,
               week_start date, lesson_number integer, lessons_in_week integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select l.lesson_date, l.period_number, l.start_time, l.end_time, l.ws,
         l.n::integer, l.total::integer
  from (
    select cl.*, date_trunc('week', cl.lesson_date)::date as ws,
           row_number() over (partition by date_trunc('week', cl.lesson_date) order by cl.lesson_date, cl.period_number) as n,
           count(*) over (partition by date_trunc('week', cl.lesson_date)) as total
    from class_lessons_between(p_class_id, date_trunc('week', p_from)::date,
                               date_trunc('week', p_to)::date + 4) cl
  ) l
  where l.lesson_date between p_from and p_to
  order by 1, 2;
$$;

revoke execute on function public.class_week_lessons(integer, date, date) from public, anon;
grant execute on function public.class_week_lessons(integer, date, date) to authenticated;

-- The class's lesson of that number in the week starting p_week_start, or no row.
create or replace function public.class_nth_lesson(p_class_id integer, p_week_start date, p_lesson_number integer)
returns table (lesson_date date, period_number integer, starts_at timestamp)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select cl.lesson_date, cl.period_number, cl.lesson_date + cl.start_time
  from class_lessons_between(p_class_id, p_week_start, p_week_start + 4) cl
  order by cl.lesson_date, cl.period_number
  offset greatest(p_lesson_number, 1) - 1
  limit 1;
$$;

revoke execute on function public.class_nth_lesson(integer, date, integer) from public, anon;
grant execute on function public.class_nth_lesson(integer, date, integer) to authenticated;

-- 3. The worksheets table takes both kinds ---------------------------------------------

alter table public.lesson_worksheets
  alter column class_id drop not null,
  alter column lesson_date drop not null,
  alter column period_number drop not null,
  alter column opens_at drop not null,
  add column subject_id integer references public.subjects(subject_id),
  add column year_group integer,
  add column week_start date,
  add column lesson_number integer;

alter table public.lesson_worksheets drop constraint lesson_worksheets_path_check;

alter table public.lesson_worksheets add constraint lesson_worksheets_kind_check check (
  (class_id is not null and lesson_date is not null and period_number is not null and opens_at is not null
     and subject_id is null and year_group is null and week_start is null and lesson_number is null
     and storage_path like class_id::text || '/%')
  or
  (class_id is null and lesson_date is null and period_number is null and opens_at is null and slot_id is null
     and subject_id is not null and year_group is not null and week_start is not null
     and extract(isodow from week_start) = 1 and lesson_number between 1 and 20
     and storage_path like 's' || subject_id::text || '-y' || year_group::text || '/%')
);

create index lesson_worksheets_year_week on public.lesson_worksheets (subject_id, year_group, week_start)
  where subject_id is not null;

comment on table public.lesson_worksheets is
  'Worksheets on lessons (migrations 428-430). Either one lesson of a class (class_id, lesson_date, period_number; opens_at is the lesson''s start) or a whole year (subject_id, year_group, week_start, lesson_number: every class of that subject and year at its own lesson of that number in the week). Students open one only from the start of the lesson. Files in the private lesson-worksheets bucket.';

create or replace function public.lesson_worksheets_prepare()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_slot timetable_slots%rowtype;
begin
  new.title := btrim(new.title);

  if new.class_id is null then
    -- A year worksheet: some class of that subject and year must have a
    -- lesson of that number in that week.
    new.opens_at := null;
    new.slot_id := null;
    if new.week_start is not null then
      new.week_start := date_trunc('week', new.week_start)::date;
    end if;
    if not exists (
      select 1 from classes c
      cross join lateral class_nth_lesson(c.class_id, new.week_start, new.lesson_number) l
      where c.subject_id = new.subject_id and c.year_group = new.year_group) then
      raise exception 'No Year % class in that subject has a lesson % in the week of %.',
        new.year_group, new.lesson_number, to_char(new.week_start, 'FMDD Mon YYYY');
    end if;
    return new;
  end if;

  select * into v_slot from timetable_slots ts
  where ts.class_id = new.class_id
    and ts.period_number = new.period_number
    and ts.day_of_week = to_char(new.lesson_date, 'Dy')
  order by ts.slot_id
  limit 1;
  if not found then
    raise exception 'That class has no lesson in that period on %.', to_char(new.lesson_date, 'FMDay DD Mon YYYY');
  end if;
  new.slot_id := v_slot.slot_id;
  new.opens_at := new.lesson_date + v_slot.start_time;
  return new;
end;
$$;

-- 4. Who reads and writes ---------------------------------------------------------------

-- Whether the signed-in student may open this year worksheet now: a class of
-- theirs in that subject and year, joined by the date of its lesson of that
-- number, and that lesson has started.
create or replace function public.year_worksheet_open_for_me(
  p_subject_id integer, p_year_group integer, p_week_start date, p_lesson_number integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from student_class sc
    join classes c on c.class_id = sc.class_id
    cross join lateral class_nth_lesson(c.class_id, p_week_start, p_lesson_number) l
    where sc.student_id = my_student_id()
      and c.subject_id = p_subject_id and c.year_group = p_year_group
      and coalesce(sc.joined_on, l.lesson_date) <= l.lesson_date
      and l.starts_at <= school_now());
$$;

revoke execute on function public.year_worksheet_open_for_me(integer, integer, date, integer) from public, anon;
grant execute on function public.year_worksheet_open_for_me(integer, integer, date, integer) to authenticated;

alter policy lesson_worksheets_student_read on public.lesson_worksheets
  using (
    case when class_id is not null then
      opens_at <= school_now()
      and exists (
        select 1 from student_class sc
        where sc.student_id = (select my_student_id())
          and sc.class_id = lesson_worksheets.class_id
          and coalesce(sc.joined_on, lesson_worksheets.lesson_date) <= lesson_worksheets.lesson_date)
    else
      (select my_student_id()) is not null
      and year_worksheet_open_for_me(subject_id, year_group, week_start, lesson_number)
    end);

alter policy lesson_worksheets_add on public.lesson_worksheets
  with check (
    case when class_id is not null then can_add_lesson_worksheet(class_id)
         else can_add_year_worksheet(subject_id, year_group) end);

alter policy lesson_worksheets_remove on public.lesson_worksheets
  using (
    case when class_id is not null then can_add_lesson_worksheet(class_id)
         else can_add_year_worksheet(subject_id, year_group) end);

-- Files: '<class_id>/…' for a lesson worksheet, 's<subject_id>-y<year>/…' for
-- a year worksheet.
create or replace function public.can_manage_lesson_worksheet_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_folder text := split_part(coalesce(p_name, ''), '/', 1);
  v_m text[];
begin
  if split_part(coalesce(p_name, ''), '/', 2) = '' then
    return false;
  end if;
  if v_folder ~ '^[0-9]{1,9}$' then
    return can_add_lesson_worksheet(v_folder::integer);
  end if;
  v_m := regexp_match(v_folder, '^s([0-9]{1,9})-y([0-9]{1,2})$');
  if v_m is not null then
    return can_add_year_worksheet(v_m[1]::integer, v_m[2]::integer);
  end if;
  return false;
end;
$$;

-- 5. For the timetables ------------------------------------------------------------------

-- The signed-in student's worksheets on lessons between two dates (at most
-- 62 days), both kinds, each placed on the student's own lesson. Title and
-- file come back only once it is open.
create or replace function public.my_lesson_worksheets(p_from date, p_to date)
returns table (worksheet_id bigint, class_id integer, lesson_date date, period_number integer,
               opens_at timestamp, is_open boolean, title text, storage_path text, size_bytes bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with placed as (
    select w.worksheet_id, w.class_id, w.lesson_date, w.period_number, w.opens_at,
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
  order by p.lesson_date, p.period_number, p.worksheet_id;
$$;

-- Staff: where a year worksheet lands, class by class (lesson_date null =
-- that class has fewer lessons that week, so it doesn't get it).
create or replace function public.year_worksheet_placements(p_worksheet_id bigint)
returns table (class_id integer, class_code text, lesson_date date, period_number integer, starts_at timestamp)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.class_id, c.class_code, l.lesson_date, l.period_number, l.starts_at
  from lesson_worksheets w
  join classes c on c.subject_id = w.subject_id and c.year_group = w.year_group
  left join lateral class_nth_lesson(c.class_id, w.week_start, w.lesson_number) l on true
  where w.worksheet_id = p_worksheet_id
    and is_staff_or_admin()
    and exists (select 1 from timetable_slots ts where ts.class_id = c.class_id)
  order by c.class_code;
$$;

revoke execute on function public.year_worksheet_placements(bigint) from public, anon;
grant execute on function public.year_worksheet_placements(bigint) to authenticated;
