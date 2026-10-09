-- Migration 428: worksheets on lessons, locked until the lesson starts.
--
-- Why: the principal, 9 Oct 2026: the Maths department wants to trial adding
-- worksheets to lessons, but doesn't want students opening them in advance,
-- and they need to show on the students' timetable.
--
-- Now:
--   * lesson_worksheets: one row per file on one lesson of a class (class,
--     date and period, as lesson_feedback and lesson_covers identify a
--     lesson). The file lives in the private 'lesson-worksheets' bucket under
--     '<class_id>/…' (same types and 20 MB limit as homework files). The class,
--     not the worksheet id, is the folder because the page uploads straight
--     after adding the row and only knows the class.
--   * opens_at is the lesson's start (the date plus the timetable slot's start
--     time, school time). It is set by trg_lesson_worksheets_prepare from the
--     timetable, never taken from the request, and a lesson that isn't on the
--     class's timetable is refused. It is stored, so a Nova-T re-import
--     (which re-creates slots; slot_id goes null) doesn't change it.
--   * Students in the class (joined by the lesson date) can read a worksheet
--     row, and so its file, only once opens_at has passed; it stays open
--     afterwards. Before that, my_lesson_worksheets() tells their timetable
--     only that a worksheet is coming and when it opens: no title, no file.
--     The bucket's read rule goes through the row, so a copied request for
--     the file is refused too.
--   * Staff read every worksheet at any time (to print, or for cover).
--     Parents get nothing.
--   * Who adds and removes: whoever teaches or leads the class
--     (teaches_or_leads_class(): class or lesson teacher, Head of Department,
--     admin), and only for subjects in a department switched on in
--     lesson_worksheet_departments. The trial is Maths (Mathematics and
--     Further Maths). Widening it is a row in that table (migration or SQL
--     editor; there is no page for it during the trial).
--   * Nobody edits a worksheet: it is removed and added again.

set local formwork.change_note = 'Principal (direct)';

-- 1. The switch -----------------------------------------------------------------------

create table public.lesson_worksheet_departments (
  department_name text primary key,
  added_at timestamptz not null default now()
);

alter table public.lesson_worksheet_departments enable row level security;
grant select on public.lesson_worksheet_departments to authenticated;

create policy lesson_worksheet_departments_read on public.lesson_worksheet_departments
  for select to authenticated using (true);

insert into public.lesson_worksheet_departments (department_name) values ('Maths');

-- May the signed-in user add or remove worksheets on this class's lessons?
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
      join subjects s on s.subject_id = c.subject_id
      join lesson_worksheet_departments d on d.department_name = s.department_name
      where c.class_id = p_class_id)
    and teaches_or_leads_class(p_class_id, null);
$$;

revoke execute on function public.can_add_lesson_worksheet(integer) from public, anon;
grant execute on function public.can_add_lesson_worksheet(integer) to authenticated;

-- 2. The bucket -----------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-worksheets', 'lesson-worksheets', false, 20971520, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'text/csv'
])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 3. The worksheets -------------------------------------------------------------------

create table public.lesson_worksheets (
  worksheet_id bigint generated always as identity primary key,
  class_id integer not null references public.classes(class_id),
  lesson_date date not null,
  period_number integer not null,
  -- Goes empty when the Nova-T import re-creates the class's lessons; class,
  -- date and period still say which lesson it was.
  slot_id integer references public.timetable_slots(slot_id) on delete set null,
  opens_at timestamp not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  storage_path text not null unique,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint lesson_worksheets_path_check check (storage_path like class_id::text || '/%')
);

comment on table public.lesson_worksheets is
  'Worksheets on a lesson (migration 428). Students can open one only from the lesson''s start (opens_at, school time). Files are in the private lesson-worksheets bucket under <class_id>/.';

create index lesson_worksheets_class_date on public.lesson_worksheets (class_id, lesson_date);

alter table public.lesson_worksheets enable row level security;
grant select, insert, delete on public.lesson_worksheets to authenticated;

create policy lesson_worksheets_staff_read on public.lesson_worksheets
  for select to authenticated using ((select is_staff_or_admin()));
-- A student in the class, once the lesson has started.
create policy lesson_worksheets_student_read on public.lesson_worksheets
  for select to authenticated using (
    opens_at <= school_now()
    and exists (
      select 1 from student_class sc
      where sc.student_id = (select my_student_id())
        and sc.class_id = lesson_worksheets.class_id
        and coalesce(sc.joined_on, lesson_worksheets.lesson_date) <= lesson_worksheets.lesson_date));
create policy lesson_worksheets_add on public.lesson_worksheets
  for insert to authenticated with check (can_add_lesson_worksheet(class_id));
create policy lesson_worksheets_remove on public.lesson_worksheets
  for delete to authenticated using (can_add_lesson_worksheet(class_id));

-- The lesson must be on the class's timetable; its start is when students can
-- open the worksheet.
create or replace function public.lesson_worksheets_prepare()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_slot timetable_slots%rowtype;
begin
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
  new.title := btrim(new.title);
  return new;
end;
$$;

revoke execute on function public.lesson_worksheets_prepare() from public, anon, authenticated;

create trigger trg_lesson_worksheets_prepare before insert on public.lesson_worksheets
  for each row execute function public.lesson_worksheets_prepare();

create trigger trg_stamp_created_by before insert on public.lesson_worksheets
  for each row execute function public.stamp_actor('created_by');

-- 4. The files ------------------------------------------------------------------------

-- May upload or remove a file at this storage path: the first folder must be
-- the id of a class the caller can add worksheets to. Parsed
-- here, safely, rather than cast inside a policy, where a malformed path
-- would raise.
create or replace function public.can_manage_lesson_worksheet_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_id !~ '^[0-9]{1,9}$' or split_part(p_name, '/', 2) = '' then
    return false;
  end if;
  return can_add_lesson_worksheet(v_id::integer);
end;
$$;

revoke execute on function public.can_manage_lesson_worksheet_file(text) from public, anon;
grant execute on function public.can_manage_lesson_worksheet_file(text) to authenticated;

create policy lesson_worksheet_files_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lesson-worksheets' and can_manage_lesson_worksheet_file(name));
create policy lesson_worksheet_files_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'lesson-worksheets' and can_manage_lesson_worksheet_file(name));
-- Readable only through a worksheet row the caller can see, so a student
-- can't open the file before the lesson starts.
create policy lesson_worksheet_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'lesson-worksheets' and exists (
    select 1 from lesson_worksheets w where w.storage_path = storage.objects.name));

-- 5. For the timetables ---------------------------------------------------------------

-- The signed-in student's worksheets on lessons between two dates (at most
-- 62 days): every worksheet on a class they had joined by the lesson date,
-- with is_open. Title and file come back only once it is open; before that
-- the timetable shows only that one is coming and when it opens.
create or replace function public.my_lesson_worksheets(p_from date, p_to date)
returns table (worksheet_id bigint, class_id integer, lesson_date date, period_number integer,
               opens_at timestamp, is_open boolean, title text, storage_path text, size_bytes bigint)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select w.worksheet_id, w.class_id, w.lesson_date, w.period_number, w.opens_at,
         w.opens_at <= school_now(),
         case when w.opens_at <= school_now() then w.title end,
         case when w.opens_at <= school_now() then w.storage_path end,
         case when w.opens_at <= school_now() then w.size_bytes end
  from lesson_worksheets w
  join student_class sc on sc.class_id = w.class_id and sc.student_id = my_student_id()
  where w.lesson_date between p_from and least(p_to, p_from + 62)
    and coalesce(sc.joined_on, w.lesson_date) <= w.lesson_date
  order by w.lesson_date, w.period_number, w.worksheet_id;
$$;

revoke execute on function public.my_lesson_worksheets(date, date) from public, anon;
grant execute on function public.my_lesson_worksheets(date, date) to authenticated;

-- A class's lessons between two dates (at most 62 days), in term and not on
-- a holiday, for the teacher's worksheet panel on the register. Reads only
-- what every signed-in user can already read.
create or replace function public.class_lessons_between(p_class_id integer, p_from date, p_to date)
returns table (lesson_date date, period_number integer, start_time time, end_time time)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select d::date, ts.period_number, ts.start_time, ts.end_time
  from generate_series(p_from, least(p_to, p_from + 62), interval '1 day') d
  join timetable_slots ts on ts.class_id = p_class_id and ts.day_of_week = to_char(d, 'Dy')
  where exists (select 1 from terms t where d::date between t.start_date and t.end_date)
    and not exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = d::date)
  order by 1, 2;
$$;

revoke execute on function public.class_lessons_between(integer, date, date) from public, anon;
grant execute on function public.class_lessons_between(integer, date, date) to authenticated;
