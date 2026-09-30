-- Migration 278: homework, piloted on the principal's two maths classes.
--
-- Applied to the live database on 30 Sept 2026 under the name 276_homework;
-- renumbered here because another 276 reached main first.
--
-- Why: the principal asked (30 Sept 2026) for teachers to set homework with a
-- deadline and a grading system, for it to show on the student's weekly
-- timetable and on a by-day Homework grid, and for the teacher to record a
-- grade for each student, outside the reporting process. The design and the
-- principal's answers are in docs/homework-design.md. To test it first, it is
-- switched on for 10_1/Ma and 11_1/Ma only (the principal's own classes).
--
-- Now:
--   * homework_schemes / homework_scheme_values: the grading systems a
--     teacher picks from. Edited by Lookups holders; never deleted, only
--     retired, so old grades stay readable.
--   * homework_classes: the pilot switch. Homework can only be set for a
--     class listed here (admin-only to change). Switching it on for more
--     classes is an insert; switching it off stops new homework but keeps
--     everything already set and marked.
--   * homework: one row per piece of homework for one class. Subject, class
--     code, year group and academic year are copied from the class by trigger
--     (never taken from the request), so the record survives the class being
--     deleted at the year switch.
--   * homework_marks: one grade per student per homework, checked against the
--     scheme by trigger. Logged permanently in grade_history like every other
--     grade (CLAUDE.md), but never read by reports, transcripts or result sets.
--   * Who can do what (the principal's decisions):
--       - set, edit and mark: the class teacher, the teacher of any single
--         lesson of the class, the Head of Department for the subject, admin
--         (can_set_homework()), and only for pilot classes;
--       - read grades: those people plus SMT (can_view_homework_marks()).
--         Mentors, pastoral staff and assessment managers can't, so
--         grade_history_read is narrowed to keep homework rows from them;
--       - read what was set: all staff;
--       - students: their own classes' homework, and their own grade once
--         the teacher releases it, current academic year only (my_homework());
--       - parents: nothing. No policy here mentions parents.
--   * /homework is added as a resource with no role grants yet: during the
--     pilot only admins see the tile.

set local formwork.change_note = 'Principal (direct)';

-- 1. Grading schemes ----------------------------------------------------------------

create table if not exists public.homework_schemes (
  scheme_id integer generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  kind text not null check (kind in ('mark', 'list', 'none')),
  -- For 'mark': a fixed maximum (100 for Percentage), or null when the
  -- teacher sets "out of" on each homework.
  fixed_max numeric check (fixed_max is null or fixed_max > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  check (kind = 'mark' or fixed_max is null)
);

comment on table public.homework_schemes is
  'Grading systems a teacher can pick for a homework (migration 278). Retired with is_active = false, never deleted.';

create table if not exists public.homework_scheme_values (
  scheme_id integer not null references public.homework_schemes(scheme_id),
  value text not null check (btrim(value) <> '' and value not in ('Not handed in', 'Excused')),
  sort_order integer not null default 0,
  primary key (scheme_id, value)
);

comment on table public.homework_scheme_values is
  'The allowed grades of a list-type homework scheme, best first (migration 278). "Not handed in" and "Excused" are allowed for every scheme and are not listed here.';

insert into public.homework_schemes (name, kind, fixed_max, sort_order) values
  ('Mark out of …', 'mark', null, 1),
  ('Percentage', 'mark', 100, 2),
  ('A*–U', 'list', null, 3),
  ('9–1 (IGCSE)', 'list', null, 4),
  ('WAEC', 'list', null, 5),
  ('Effort 1–4', 'list', null, 6),
  ('Complete / Incomplete', 'list', null, 7),
  ('Not graded', 'none', null, 8)
on conflict (name) do nothing;

insert into public.homework_scheme_values (scheme_id, value, sort_order)
select s.scheme_id, v.value, v.ord
from public.homework_schemes s
join (values
  ('A*–U', array['A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'U']),
  ('9–1 (IGCSE)', array['9', '8', '7', '6', '5', '4', '3', '2', '1', 'U']),
  ('WAEC', array['A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9']),
  ('Effort 1–4', array['1', '2', '3', '4']),
  ('Complete / Incomplete', array['Complete', 'Incomplete'])
) as l(name, vals) on l.name = s.name
cross join lateral unnest(l.vals) with ordinality as v(value, ord)
on conflict do nothing;

alter table public.homework_schemes enable row level security;
alter table public.homework_scheme_values enable row level security;
grant select, insert, update on public.homework_schemes to authenticated;
grant select, insert, update on public.homework_scheme_values to authenticated;

create policy "Homework schemes readable by all authenticated"
  on public.homework_schemes for select to authenticated using (true);
create policy "Homework schemes added on Lookups"
  on public.homework_schemes for insert to authenticated
  with check (has_resource_access('/admin/lookups'));
create policy "Homework schemes edited on Lookups"
  on public.homework_schemes for update to authenticated
  using (has_resource_access('/admin/lookups'))
  with check (has_resource_access('/admin/lookups'));

create policy "Homework scheme values readable by all authenticated"
  on public.homework_scheme_values for select to authenticated using (true);
create policy "Homework scheme values added on Lookups"
  on public.homework_scheme_values for insert to authenticated
  with check (has_resource_access('/admin/lookups'));
create policy "Homework scheme values edited on Lookups"
  on public.homework_scheme_values for update to authenticated
  using (has_resource_access('/admin/lookups'))
  with check (has_resource_access('/admin/lookups'));

-- 2. The pilot switch ----------------------------------------------------------------

create table if not exists public.homework_classes (
  class_id integer primary key references public.classes(class_id) on delete cascade,
  enabled_by uuid,
  enabled_at timestamptz not null default now()
);

comment on table public.homework_classes is
  'Classes homework is switched on for (migration 278, pilot). Homework can only be set for these. Admin-only to change.';

alter table public.homework_classes enable row level security;
grant select, insert, delete on public.homework_classes to authenticated;

create policy "Homework classes readable by all authenticated"
  on public.homework_classes for select to authenticated using (true);
create policy "Homework classes switched on by admins"
  on public.homework_classes for insert to authenticated with check (is_admin());
create policy "Homework classes switched off by admins"
  on public.homework_classes for delete to authenticated using (is_admin());

create trigger trg_stamp_enabled_by before insert on public.homework_classes
  for each row execute function public.stamp_actor('enabled_by');

-- The pilot: the principal's own maths classes.
insert into public.homework_classes (class_id)
select class_id from public.classes where class_code in ('10_1/Ma', '11_1/Ma')
on conflict (class_id) do nothing;

-- 3. Homework ------------------------------------------------------------------------

create table if not exists public.homework (
  homework_id bigint generated always as identity primary key,
  class_id integer references public.classes(class_id) on delete set null,
  -- Copied from the class by homework_prepare(), never from the request.
  subject_id integer references public.subjects(subject_id),
  class_code text,
  year_group integer,
  academic_year_id integer references public.academic_years(academic_year_id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  instructions text check (instructions is null or char_length(instructions) <= 5000),
  set_on date not null default school_today(),
  due_on date not null,
  -- The lesson it's due in; null means "by the end of the day".
  due_slot_id integer references public.timetable_slots(slot_id) on delete set null,
  scheme_id integer not null references public.homework_schemes(scheme_id),
  out_of numeric check (out_of is null or out_of > 0),
  marks_released boolean not null default false,
  status text not null default 'set' check (status in ('set', 'withdrawn')),
  set_by_staff_id integer references public.staff(staff_id),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on >= set_on)
);

comment on table public.homework is
  'Homework set for one class (migration 278). Not part of reporting: nothing in reports, transcripts or result sets reads it.';

create index if not exists homework_class_due_idx on public.homework (class_id, due_on);
create index if not exists homework_due_idx on public.homework (due_on);

create or replace function public.homework_prepare()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  c classes;
  s homework_schemes;
begin
  if tg_op = 'INSERT' then
    if new.class_id is null then
      raise exception 'Homework must be set for a class.';
    end if;
    select * into c from classes where class_id = new.class_id;
    if not found then
      raise exception 'Class % not found.', new.class_id;
    end if;
    new.subject_id := c.subject_id;
    new.class_code := c.class_code;
    new.year_group := c.year_group;
    new.academic_year_id := (select academic_year_id from academic_years where status = 'current' order by start_date desc limit 1);
    new.status := 'set';
    new.marks_released := false;
    new.created_at := now();
    if auth.uid() is not null then
      new.set_by_staff_id := (select staff_id from profiles where id = auth.uid());
    end if;
  else
    -- A homework can't be moved to another class, or have what it was set
    -- for rewritten. class_id may only become null (the class was deleted).
    if new.class_id is not null and new.class_id is distinct from old.class_id then
      raise exception 'Homework can''t be moved to another class.';
    end if;
    new.subject_id := old.subject_id;
    new.class_code := old.class_code;
    new.year_group := old.year_group;
    new.academic_year_id := old.academic_year_id;
    new.set_by_staff_id := old.set_by_staff_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.set_on := old.set_on;
    if (new.scheme_id is distinct from old.scheme_id or new.out_of is distinct from old.out_of)
       and exists (select 1 from homework_marks m where m.homework_id = old.homework_id) then
      raise exception 'Marks have been recorded, so the grading system can''t be changed.';
    end if;
  end if;

  select * into s from homework_schemes where scheme_id = new.scheme_id;
  if tg_op = 'INSERT' or new.scheme_id is distinct from old.scheme_id then
    if not coalesce(s.is_active, false) then
      raise exception 'That grading system is no longer in use.';
    end if;
  end if;
  if s.kind = 'mark' and s.fixed_max is null then
    if new.out_of is null then
      raise exception 'Say what the homework is marked out of.';
    end if;
  else
    new.out_of := null;
  end if;

  if new.due_slot_id is not null and not exists (
    select 1 from timetable_slots t
    where t.slot_id = new.due_slot_id
      and t.class_id = coalesce(new.class_id, old.class_id)
      and t.day_of_week = to_char(new.due_on, 'Dy')
  ) then
    raise exception 'The lesson chosen isn''t one of this class''s lessons on the due date.';
  end if;

  new.title := btrim(new.title);
  new.instructions := nullif(btrim(coalesce(new.instructions, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_homework_prepare before insert or update on public.homework
  for each row execute function public.homework_prepare();
create trigger trg_stamp_created_by before insert on public.homework
  for each row execute function public.stamp_actor('created_by');
create trigger trg_stamp_updated_by before insert or update on public.homework
  for each row execute function public.stamp_actor('updated_by');

-- 4. Marks ---------------------------------------------------------------------------

create table if not exists public.homework_marks (
  homework_id bigint not null references public.homework(homework_id),
  student_id integer not null references public.students(student_id),
  -- Copied from the homework, for the grade log.
  subject_id integer,
  -- A list scheme's value, or 'Not handed in' / 'Excused'.
  grade text,
  -- A mark scheme's mark, 0 to out_of (or the scheme's fixed maximum).
  score numeric,
  comment text check (comment is null or char_length(comment) <= 1000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (homework_id, student_id)
);

comment on table public.homework_marks is
  'Homework grades (migration 278), outside reporting. Every change is logged in grade_history (table_name homework_marks).';

create index if not exists homework_marks_student_idx on public.homework_marks (student_id);

create or replace function public.homework_marks_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  h homework;
  s homework_schemes;
begin
  if tg_op = 'UPDATE' and (new.homework_id <> old.homework_id or new.student_id <> old.student_id) then
    raise exception 'A mark can''t be moved to another homework or student.';
  end if;

  select * into h from homework where homework_id = new.homework_id;
  if h.status = 'withdrawn' then
    raise exception 'This homework has been withdrawn, so it can''t be marked.';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from student_class sc where sc.class_id = h.class_id and sc.student_id = new.student_id
  ) then
    raise exception 'That student isn''t in this class.';
  end if;

  select * into s from homework_schemes where scheme_id = h.scheme_id;
  new.grade := nullif(btrim(coalesce(new.grade, '')), '');
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');

  if new.grade in ('Not handed in', 'Excused') then
    new.score := null;
  elsif s.kind = 'mark' then
    if new.grade is not null then
      raise exception 'This homework is marked with a number, not a grade.';
    end if;
    if new.score is null then
      raise exception 'Enter a mark, or Not handed in / Excused.';
    end if;
    if new.score < 0 or new.score > coalesce(h.out_of, s.fixed_max) then
      raise exception 'The mark must be between 0 and %.', coalesce(h.out_of, s.fixed_max);
    end if;
  elsif s.kind = 'list' then
    new.score := null;
    if new.grade is null or not exists (
      select 1 from homework_scheme_values v where v.scheme_id = s.scheme_id and v.value = new.grade
    ) then
      raise exception '"%" isn''t a grade in %.', coalesce(new.grade, ''), s.name;
    end if;
  else
    raise exception 'This homework isn''t graded: record Not handed in or Excused only.';
  end if;

  new.subject_id := h.subject_id;
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_homework_marks_check before insert or update on public.homework_marks
  for each row execute function public.homework_marks_check();
create trigger trg_stamp_updated_by before insert or update on public.homework_marks
  for each row execute function public.stamp_actor('updated_by');

-- A homework with marks is withdrawn, not deleted, so no grade disappears.
create or replace function public.homework_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if exists (select 1 from homework_marks m where m.homework_id = old.homework_id) then
    raise exception 'Marks have been recorded for this homework, so it can''t be deleted. Withdraw it instead.';
  end if;
  return old;
end;
$$;

create trigger trg_homework_delete_guard before delete on public.homework
  for each row execute function public.homework_delete_guard();

-- 5. Who may do what -------------------------------------------------------------------

create or replace function public.my_student_id()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select student_id from profiles where id = auth.uid();
$$;

-- Teaches the class (as class teacher or for any single lesson), is Head of
-- Department for its subject, or is admin. Not pilot-aware: used for reading.
create or replace function public.teaches_or_leads_class(p_class_id integer, p_subject_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select is_admin()
    or exists (
      select 1 from profiles p join classes c on c.staff_id = p.staff_id
      where p.id = auth.uid() and p.staff_id is not null and c.class_id = p_class_id)
    or exists (
      select 1 from profiles p join timetable_slots t on t.staff_id = p.staff_id
      where p.id = auth.uid() and p.staff_id is not null and t.class_id = p_class_id)
    or exists (
      select 1 from profiles p
      join staff_roles sr on sr.staff_id = p.staff_id
      join subjects s on s.department_name = sr.scope_value
      where p.id = auth.uid()
        and sr.role_name = 'head_of_department' and sr.scope_type = 'department'
        and s.subject_id = coalesce(p_subject_id, (select subject_id from classes where class_id = p_class_id)));
$$;

-- May set, edit, withdraw and mark homework for this class.
create or replace function public.can_set_homework(p_class_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_class_id is not null
    and exists (select 1 from homework_classes hc where hc.class_id = p_class_id)
    and teaches_or_leads_class(p_class_id, null);
$$;

-- May read this homework's grades: those who teach or lead it, plus SMT.
create or replace function public.can_view_homework_marks(p_homework_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select user_has_staff_role(array['smt'])
    or exists (
      select 1 from homework h
      where h.homework_id = p_homework_id
        and teaches_or_leads_class(h.class_id, h.subject_id));
$$;

revoke execute on function public.my_student_id() from public, anon;
revoke execute on function public.teaches_or_leads_class(integer, integer) from public, anon;
revoke execute on function public.can_set_homework(integer) from public, anon;
revoke execute on function public.can_view_homework_marks(bigint) from public, anon;
grant execute on function public.my_student_id() to authenticated;
grant execute on function public.teaches_or_leads_class(integer, integer) to authenticated;
grant execute on function public.can_set_homework(integer) to authenticated;
grant execute on function public.can_view_homework_marks(bigint) to authenticated;

alter table public.homework enable row level security;
alter table public.homework_marks enable row level security;
grant select, insert, update, delete on public.homework to authenticated;
grant select, insert, update, delete on public.homework_marks to authenticated;

create policy "Homework readable by staff"
  on public.homework for select to authenticated using (is_staff_or_admin());
create policy "Homework readable by students in the class"
  on public.homework for select to authenticated
  using (status = 'set' and class_id in (
    select sc.class_id from student_class sc where sc.student_id = my_student_id()));
create policy "Homework set by those who teach the class"
  on public.homework for insert to authenticated
  with check (can_set_homework(class_id) and status = 'set' and not marks_released);
create policy "Homework edited by those who teach the class"
  on public.homework for update to authenticated
  using (can_set_homework(class_id))
  with check (can_set_homework(class_id));
create policy "Homework deleted by those who teach the class"
  on public.homework for delete to authenticated
  using (can_set_homework(class_id));

create policy "Homework marks readable by the class's teachers, HoD and SMT"
  on public.homework_marks for select to authenticated
  using (can_view_homework_marks(homework_id));
create policy "Own released homework marks readable by the student"
  on public.homework_marks for select to authenticated
  using (student_id = my_student_id() and exists (
    select 1 from homework h join academic_years y on y.academic_year_id = h.academic_year_id
    where h.homework_id = homework_marks.homework_id
      and h.marks_released and h.status = 'set' and y.status = 'current'));
create policy "Homework marks recorded by those who teach the class"
  on public.homework_marks for insert to authenticated
  with check (can_set_homework((select h.class_id from homework h where h.homework_id = homework_marks.homework_id)));
create policy "Homework marks changed by those who teach the class"
  on public.homework_marks for update to authenticated
  using (can_set_homework((select h.class_id from homework h where h.homework_id = homework_marks.homework_id)))
  with check (can_set_homework((select h.class_id from homework h where h.homework_id = homework_marks.homework_id)));
create policy "Homework marks removed by those who teach the class"
  on public.homework_marks for delete to authenticated
  using (can_set_homework((select h.class_id from homework h where h.homework_id = homework_marks.homework_id)));

-- 6. What a student sees ---------------------------------------------------------------

-- The signed-in student's homework due between two dates, with their own mark
-- only once released and only for the current academic year. Takes no student
-- ID, so it can't be pointed at anyone else; returns nothing for non-students.
create or replace function public.my_homework(p_from date, p_to date)
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
  marked boolean
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
         m.grade, m.score, m.comment, (m.homework_id is not null)
  from homework h
  join academic_years y on y.academic_year_id = h.academic_year_id and y.status = 'current'
  join homework_schemes sch on sch.scheme_id = h.scheme_id
  left join subjects sub on sub.subject_id = h.subject_id
  left join staff st on st.staff_id = h.set_by_staff_id
  left join timetable_slots t on t.slot_id = h.due_slot_id
  left join homework_marks m on m.homework_id = h.homework_id and m.student_id = v_student and h.marks_released
  where h.status = 'set'
    and h.due_on between p_from and p_to
    and (h.class_id in (select sc.class_id from student_class sc where sc.student_id = v_student)
         or exists (select 1 from homework_marks m2 where m2.homework_id = h.homework_id and m2.student_id = v_student))
  order by h.due_on, t.period_number nulls last, h.homework_id;
end;
$$;

revoke execute on function public.my_homework(date, date) from public, anon;
grant execute on function public.my_homework(date, date) to authenticated;

-- 7. Grade log ------------------------------------------------------------------------------

-- (No backup-mode triggers here: the guard_new_tables event trigger adds
-- a_backup_mode_guard to every new public table by itself.)

-- log_grade_change() as in migration 215, plus the homework_marks key.
create or replace function public.log_grade_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_grade_col text := case tg_table_name when 'target_grades' then 'target_grade' else 'grade' end;
  v_key jsonb;
  v_staff_id integer;
  v_role text;
begin
  -- An update that changes nothing but bookkeeping columns isn't a change.
  if tg_op = 'UPDATE'
     and (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
    return new;
  end if;

  v_key := case tg_table_name
    when 'results' then jsonb_build_object('result_id', v_row->'result_id')
    when 'transcript_grades' then jsonb_build_object(
      'student_id', v_row->'student_id', 'subject_id', v_row->'subject_id',
      'year_group', v_row->'year_group', 'term_number', v_row->'term_number')
    when 'homework_marks' then jsonb_build_object(
      'homework_id', v_row->'homework_id', 'student_id', v_row->'student_id')
    else jsonb_build_object('student_id', v_row->'student_id', 'subject_id', v_row->'subject_id')
  end;

  select p.staff_id, p.role into v_staff_id, v_role from profiles p where p.id = auth.uid();

  insert into grade_history (
    table_name, action, student_id, subject_id, record_key,
    old_grade, new_grade, old_score, new_score, old_row, new_row,
    changed_by, changed_by_staff_id, changed_by_role, changed_by_name, note
  ) values (
    tg_table_name, tg_op,
    (v_row->>'student_id')::integer, (v_row->>'subject_id')::integer, v_key,
    v_old->>v_grade_col, v_new->>v_grade_col,
    (v_old->>'score')::numeric, (v_new->>'score')::numeric,
    v_old, v_new,
    auth.uid(), v_staff_id, v_role, profile_display_name(auth.uid()),
    case when auth.uid() is null then nullif(current_setting('formwork.change_note', true), '') end
  );

  return coalesce(new, old);
end;
$$;

create trigger trg_log_grade_change after insert or update or delete on public.homework_marks
  for each row execute function public.log_grade_change();

-- Assessment managers read grade_history but not homework grades.
drop policy if exists grade_history_read on public.grade_history;
create policy grade_history_read on public.grade_history for select to authenticated
  using (user_has_staff_role(array['smt', 'assessment_manager'])
         and (table_name <> 'homework_marks' or user_has_staff_role(array['smt'])));

-- 8. The staff page ------------------------------------------------------------------------

-- No role grants during the pilot: only admins see /homework.
insert into public.resources (resource_key, label, section, sort_order)
values ('/homework', 'Homework', 'Students', 16)
on conflict (resource_key) do nothing;
