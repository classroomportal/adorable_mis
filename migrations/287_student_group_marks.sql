-- Migration 287: student groups, stage 3: mark sheets for a group, outside
-- reporting.
--
-- Why (the principal, 30 Sept 2026): groups are sometimes made "for recording
-- particular marks" (a sports trial, a reading test, a prefect interview).
-- The principal decided these marks stay outside reporting, like homework,
-- and that students and parents don't see them in the first version. The
-- design is in docs/student-groups-design.md.
--
-- Now:
--   * student_group_mark_sheets: one per test or occasion for a group: a
--     title, a date and a grading system chosen from homework's
--     (homework_schemes: Mark out of …, Percentage, A*–U, 9–1, WAEC,
--     Effort 1–4, Complete / Incomplete, Not graded), so the school has one
--     list of grading systems. Once any mark is recorded the grading system
--     can't change and the sheet can't be deleted, only withdrawn.
--   * student_group_marks: one mark per student per sheet, checked against
--     the grading system (a mark between 0 and the maximum, or one of its
--     grades; "Absent", "Not handed in" and "Excused" fit any system), and
--     only for students in the group. An archived group's marks are kept
--     but can't be changed.
--   * Who records and reads marks: the staff who run the group, and those who
--     manage groups (smt, pastoral, school_office, admin), through
--     can_mark_student_group(). Everyone else on the staff sees that a sheet
--     exists but not the marks. Students and parents get nothing.
--   * Every mark entered, changed or deleted is logged permanently in
--     grade_history (table_name 'student_group_marks'), like every grade.
--     Only SMT and admins can read those rows there (like homework); the
--     assessment managers' view of grade_history is unchanged otherwise.
--   * Nothing in reports, transcripts, result sets or target grades reads
--     these tables, and nothing writes them to results.

-- 1. Who may record and read a group's marks ---------------------------------------------

create or replace function public.can_mark_student_group(p_group_id bigint)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select can_manage_student_groups()
    or exists (
      select 1 from student_group_staff gs
      join profiles p on p.staff_id = gs.staff_id
      where p.id = auth.uid() and gs.group_id = p_group_id);
$$;

revoke execute on function public.can_mark_student_group(bigint) from public, anon;
grant execute on function public.can_mark_student_group(bigint) to authenticated;

-- 2. Mark sheets ---------------------------------------------------------------------------

create table if not exists public.student_group_mark_sheets (
  sheet_id bigint generated always as identity primary key,
  group_id bigint not null references public.student_groups(group_id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  marked_on date not null default school_today(),
  scheme_id integer not null references public.homework_schemes(scheme_id),
  out_of numeric check (out_of is null or out_of > 0),
  status text not null default 'open' check (status in ('open', 'withdrawn')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.student_group_mark_sheets is
  'A test or occasion marked for a student group (migration 287). Outside reporting. Withdrawn, not deleted, once marked.';

create index if not exists student_group_mark_sheets_group_idx on public.student_group_mark_sheets (group_id, marked_on);

create or replace function public.student_group_mark_sheets_prepare()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  s homework_schemes;
begin
  if tg_op = 'INSERT' then
    new.status := 'open';
    new.created_at := now();
    if exists (select 1 from student_groups g where g.group_id = new.group_id and g.archived_at is not null) then
      raise exception 'This group is archived.';
    end if;
  else
    if new.group_id <> old.group_id then
      raise exception 'A mark sheet can''t be moved to another group.';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if (new.scheme_id is distinct from old.scheme_id or new.out_of is distinct from old.out_of)
       and exists (select 1 from student_group_marks m where m.sheet_id = old.sheet_id) then
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
      raise exception 'Say what the sheet is marked out of.';
    end if;
  else
    new.out_of := null;
  end if;

  new.title := btrim(new.title);
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.student_group_mark_sheets_prepare() from public, anon, authenticated;

drop trigger if exists trg_mark_sheets_prepare on public.student_group_mark_sheets;
create trigger trg_mark_sheets_prepare before insert or update on public.student_group_mark_sheets
  for each row execute function public.student_group_mark_sheets_prepare();
drop trigger if exists trg_stamp_created_by on public.student_group_mark_sheets;
create trigger trg_stamp_created_by before insert on public.student_group_mark_sheets
  for each row execute function public.stamp_actor('created_by');
drop trigger if exists trg_stamp_updated_by on public.student_group_mark_sheets;
create trigger trg_stamp_updated_by before insert or update on public.student_group_mark_sheets
  for each row execute function public.stamp_actor('updated_by');

-- 3. Marks ------------------------------------------------------------------------------------

create table if not exists public.student_group_marks (
  sheet_id bigint not null references public.student_group_mark_sheets(sheet_id),
  student_id integer not null references public.students(student_id),
  -- A list scheme's value, or 'Absent' / 'Not handed in' / 'Excused'.
  grade text,
  -- A mark scheme's mark, 0 to out_of (or the scheme's fixed maximum).
  score numeric,
  comment text check (comment is null or char_length(comment) <= 1000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (sheet_id, student_id)
);

comment on table public.student_group_marks is
  'Marks for a student group''s mark sheet (migration 287), outside reporting. Every change is logged in grade_history (table_name student_group_marks).';

create index if not exists student_group_marks_student_idx on public.student_group_marks (student_id);

create or replace function public.student_group_marks_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  sh student_group_mark_sheets;
  s homework_schemes;
  v_max numeric;
begin
  if tg_op = 'UPDATE' and (new.sheet_id <> old.sheet_id or new.student_id <> old.student_id) then
    raise exception 'A mark can''t be moved to another sheet or student.';
  end if;

  select * into sh from student_group_mark_sheets where sheet_id = new.sheet_id;
  if sh.status = 'withdrawn' then
    raise exception 'This mark sheet has been withdrawn, so it can''t be marked.';
  end if;
  if exists (select 1 from student_groups g where g.group_id = sh.group_id and g.archived_at is not null) then
    raise exception 'This group is archived, so its marks can''t be changed.';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from student_group_members gm where gm.group_id = sh.group_id and gm.student_id = new.student_id
  ) then
    raise exception 'That student isn''t in this group.';
  end if;

  select * into s from homework_schemes where scheme_id = sh.scheme_id;
  v_max := coalesce(sh.out_of, s.fixed_max);
  new.grade := nullif(btrim(coalesce(new.grade, '')), '');
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');

  if new.grade in ('Absent', 'Not handed in', 'Excused') then
    new.score := null;
  elsif s.kind = 'mark' then
    if new.grade is not null then
      raise exception 'This sheet is marked with a number, not a grade.';
    end if;
    if new.score is null then
      raise exception 'Enter a mark, or Absent / Not handed in / Excused.';
    end if;
    if new.score < 0 or new.score > v_max then
      raise exception 'The mark must be between 0 and %.', v_max;
    end if;
  elsif s.kind = 'list' then
    new.score := null;
    if new.grade is null or not exists (
      select 1 from homework_scheme_values v where v.scheme_id = s.scheme_id and v.value = new.grade
    ) then
      raise exception '"%" isn''t a grade in %.', coalesce(new.grade, ''), s.name;
    end if;
  else
    raise exception 'This sheet isn''t graded: record Absent, Not handed in or Excused only.';
  end if;

  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.student_group_marks_check() from public, anon, authenticated;

drop trigger if exists trg_group_marks_check on public.student_group_marks;
create trigger trg_group_marks_check before insert or update on public.student_group_marks
  for each row execute function public.student_group_marks_check();
drop trigger if exists trg_stamp_updated_by on public.student_group_marks;
create trigger trg_stamp_updated_by before insert or update on public.student_group_marks
  for each row execute function public.stamp_actor('updated_by');

-- A sheet with marks is withdrawn, not deleted, so no mark disappears.
create or replace function public.student_group_mark_sheets_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if exists (select 1 from student_group_marks m where m.sheet_id = old.sheet_id) then
    raise exception 'Marks have been recorded on this sheet, so it can''t be deleted. Withdraw it instead.';
  end if;
  return old;
end;
$$;

revoke execute on function public.student_group_mark_sheets_delete_guard() from public, anon, authenticated;

drop trigger if exists trg_mark_sheets_delete_guard on public.student_group_mark_sheets;
create trigger trg_mark_sheets_delete_guard before delete on public.student_group_mark_sheets
  for each row execute function public.student_group_mark_sheets_delete_guard();

-- 4. Access ----------------------------------------------------------------------------------

alter table public.student_group_mark_sheets enable row level security;
alter table public.student_group_marks enable row level security;
grant select, insert, update, delete on public.student_group_mark_sheets to authenticated;
grant select, insert, update, delete on public.student_group_marks to authenticated;

drop policy if exists group_mark_sheets_staff_read on public.student_group_mark_sheets;
create policy group_mark_sheets_staff_read on public.student_group_mark_sheets
  for select to authenticated using (is_staff_or_admin());
drop policy if exists group_mark_sheets_insert on public.student_group_mark_sheets;
create policy group_mark_sheets_insert on public.student_group_mark_sheets
  for insert to authenticated with check (can_mark_student_group(group_id) and status = 'open');
drop policy if exists group_mark_sheets_update on public.student_group_mark_sheets;
create policy group_mark_sheets_update on public.student_group_mark_sheets
  for update to authenticated using (can_mark_student_group(group_id)) with check (can_mark_student_group(group_id));
drop policy if exists group_mark_sheets_delete on public.student_group_mark_sheets;
create policy group_mark_sheets_delete on public.student_group_mark_sheets
  for delete to authenticated using (can_mark_student_group(group_id));

drop policy if exists group_marks_read on public.student_group_marks;
create policy group_marks_read on public.student_group_marks
  for select to authenticated
  using (can_mark_student_group((select sh.group_id from student_group_mark_sheets sh where sh.sheet_id = student_group_marks.sheet_id)));
drop policy if exists group_marks_insert on public.student_group_marks;
create policy group_marks_insert on public.student_group_marks
  for insert to authenticated
  with check (can_mark_student_group((select sh.group_id from student_group_mark_sheets sh where sh.sheet_id = student_group_marks.sheet_id)));
drop policy if exists group_marks_update on public.student_group_marks;
create policy group_marks_update on public.student_group_marks
  for update to authenticated
  using (can_mark_student_group((select sh.group_id from student_group_mark_sheets sh where sh.sheet_id = student_group_marks.sheet_id)))
  with check (can_mark_student_group((select sh.group_id from student_group_mark_sheets sh where sh.sheet_id = student_group_marks.sheet_id)));
drop policy if exists group_marks_delete on public.student_group_marks;
create policy group_marks_delete on public.student_group_marks
  for delete to authenticated
  using (can_mark_student_group((select sh.group_id from student_group_mark_sheets sh where sh.sheet_id = student_group_marks.sheet_id)));

-- 5. Grade History --------------------------------------------------------------------------

alter table public.grade_history drop constraint if exists grade_history_table_name_check;
alter table public.grade_history add constraint grade_history_table_name_check
  check (table_name = any (array['results', 'target_grades', 'transcript_grades', 'homework_marks', 'student_group_marks']));

-- log_grade_change() as live (migrations 215, 219, 278), plus the group marks key.
create or replace function public.log_grade_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
    when 'student_group_marks' then jsonb_build_object(
      'sheet_id', v_row->'sheet_id', 'student_id', v_row->'student_id')
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
$function$;

drop trigger if exists trg_log_grade_change on public.student_group_marks;
create trigger trg_log_grade_change after insert or update or delete on public.student_group_marks
  for each row execute function public.log_grade_change();

-- Group marks, like homework, are read in Grade History by SMT and admins only.
drop policy if exists grade_history_read on public.grade_history;
create policy grade_history_read on public.grade_history
  for select to authenticated
  using (user_has_staff_role(array['smt', 'assessment_manager'])
         and (table_name not in ('homework_marks', 'student_group_marks') or user_has_staff_role(array['smt'])));
