-- Migration 286: record who added each student and when, log every change to
-- a student record, and tidy spaces in names.
--
-- Why (the principal, 30 Sept 2026): asked who added the last three students,
-- the database couldn't say. students had no "added by" or "added on", and
-- student records weren't in Change History, so the answer had to come from
-- Supabase's request logs, which only go back a few days. The same check found
-- "CHIBUEZE " saved with a trailing space, "Angel " as a preferred name and a
-- parent's "Chinenye  E." with a double space; the principal asked for a fix so
-- names can't be saved with blank space at the start or end.
--
-- Now:
--   * students.created_at / created_by: stamped when a student is added through
--     the app (the signed-in person and the time), whatever the page sends, and
--     fixed after that. Students added before today have none (unknown); the
--     two added on 30 Sept through the app are filled in from the request logs
--     (Victory NNAMOKO, sro@).
--   * Change History has a new area, 'students': every student added, changed
--     or deleted, with the old and new values and who did it. The photo is
--     left out of the logged rows (it is about 26 KB each time); the log still
--     says the photo changed.
--   * log_change() takes an optional third argument: columns whose values are
--     left out of the logged rows. Nothing else about it changes, and the
--     existing triggers don't pass one.
--   * Names are tidied on every save, for students, applicants, parents and
--     staff: spaces (including non-breaking ones) removed from the start and
--     end, and runs of spaces inside a name made single. The trim runs after
--     check_student_field_edit(), so a teacher editing one field of a student
--     whose stored name had a stray space isn't refused for "changing" the
--     name. The three names above are fixed here (logged, as Principal
--     (direct)).

-- 1. Who added a student, and when ---------------------------------------------------------

alter table public.students add column if not exists created_at timestamptz;
alter table public.students add column if not exists created_by uuid;
alter table public.students alter column created_at set default now();

comment on column public.students.created_at is 'When the student was added through the app (migration 286). Null for students added before 30 Sept 2026.';
comment on column public.students.created_by is 'The login that added the student (migration 286), stamped from auth.uid(). Null for students added before 30 Sept 2026.';

create or replace function public.stamp_student_created()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      new.created_at := now();
      new.created_by := auth.uid();
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
  elsif current_user = 'authenticated' then
    -- Fixed once the student is added; only the database owner can correct it.
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_student_created() from public, anon, authenticated;

-- Named to run before trg_a_check_student_field_edit, so a request that tries
-- to change these is quietly put back rather than refused.
drop trigger if exists trg_0_stamp_student_created on public.students;
create trigger trg_0_stamp_student_created before insert or update on public.students
  for each row execute function public.stamp_student_created();

-- 2. Change History for students ------------------------------------------------------------

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_key jsonb := '{}'::jsonb;
  v_col text;
  v_student integer;
  v_staff_id integer;
  v_role text;
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where k not in ('updated_at')
      and v_old->k is distinct from v_new->k;
    if v_changed is null then
      return new;
    end if;
  end if;

  foreach v_col in array string_to_array(tg_argv[1], ',') loop
    v_key := v_key || jsonb_build_object(v_col, v_row->v_col);
  end loop;

  -- Columns too large to keep a copy of (a student's photo): the log says
  -- they changed, but not what they were (migration 286).
  if tg_nargs > 2 then
    foreach v_col in array string_to_array(tg_argv[2], ',') loop
      if v_old ? v_col and v_old->v_col <> 'null'::jsonb then
        v_old := jsonb_set(v_old, array[v_col], '"(not kept in the log)"'::jsonb);
      end if;
      if v_new ? v_col and v_new->v_col <> 'null'::jsonb then
        v_new := jsonb_set(v_new, array[v_col], '"(not kept in the log)"'::jsonb);
      end if;
    end loop;
  end if;

  -- A login row: say whose login it is (profiles holds no name, and its
  -- email column is often empty; the sign-in email lives in auth.users).
  if tg_table_name = 'profiles' then
    v_key := v_key || jsonb_build_object(
      'name', profile_display_name((v_row->>'id')::uuid),
      'email', (select u.email from auth.users u where u.id = (v_row->>'id')::uuid));
  end if;

  v_student := (v_row->>'student_id')::integer;
  if v_student is null and v_row ? 'invoice_id' then
    select si.student_id into v_student from student_invoices si where si.id = (v_row->>'invoice_id')::bigint;
  end if;

  select p.staff_id, p.role into v_staff_id, v_role from profiles p where p.id = auth.uid();

  insert into change_history (
    area, table_name, action, record_key, student_id, changed_fields,
    old_row, new_row, changed_by, changed_by_staff_id, changed_by_role, changed_by_name, note
  ) values (
    tg_argv[0], tg_table_name, tg_op, v_key, v_student, v_changed,
    v_old, v_new, auth.uid(), v_staff_id, v_role, profile_display_name(auth.uid()),
    case when auth.uid() is null then nullif(current_setting('formwork.change_note', true), '') end
  );

  return coalesce(new, old);
end;
$function$;

alter table public.change_history drop constraint if exists change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions', 'groups', 'students'));

drop trigger if exists trg_log_change on public.students;
create trigger trg_log_change after insert or update or delete on public.students
  for each row execute function public.log_change('students', 'student_id', 'photo_base64');

-- 3. Tidy spaces in names --------------------------------------------------------------------

create or replace function public.tidy_name(p text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case when p is null then null
    else regexp_replace(
      regexp_replace(p, '^[[:space:]' || chr(160) || ']+|[[:space:]' || chr(160) || ']+$', '', 'g'),
      '[[:space:]' || chr(160) || ']{2,}', ' ', 'g')
  end;
$$;

-- tg_argv: the name columns of the table.
create or replace function public.tidy_name_columns()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_fix jsonb := '{}'::jsonb;
  v_col text;
begin
  foreach v_col in array tg_argv loop
    if v_row ? v_col and jsonb_typeof(v_row->v_col) = 'string'
       and tidy_name(v_row->>v_col) is distinct from v_row->>v_col then
      v_fix := v_fix || jsonb_build_object(v_col, tidy_name(v_row->>v_col));
    end if;
  end loop;
  if v_fix <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_fix);
  end if;
  return new;
end;
$$;

revoke execute on function public.tidy_name_columns() from public, anon, authenticated;

-- After trg_a_check_student_field_edit (alphabetical order), see the header.
drop trigger if exists trg_tidy_names on public.students;
create trigger trg_tidy_names before insert or update on public.students
  for each row execute function public.tidy_name_columns('first_name', 'middle_name', 'last_name', 'preferred_name', 'legal_first_name', 'legal_last_name');

drop trigger if exists trg_tidy_names on public.applicants;
create trigger trg_tidy_names before insert or update on public.applicants
  for each row execute function public.tidy_name_columns('first_name', 'middle_name', 'last_name', 'preferred_name');

drop trigger if exists trg_tidy_names on public.parents;
create trigger trg_tidy_names before insert or update on public.parents
  for each row execute function public.tidy_name_columns('first_name', 'last_name');

drop trigger if exists trg_tidy_names on public.staff;
create trigger trg_tidy_names before insert or update on public.staff
  for each row execute function public.tidy_name_columns('first_name', 'last_name');

-- 4. The data ----------------------------------------------------------------------------------

-- The names found with stray spaces (the triggers above tidy them).
update public.students set last_name = last_name where last_name <> tidy_name(last_name);
update public.students set preferred_name = preferred_name where preferred_name <> tidy_name(preferred_name);
update public.students set first_name = first_name, middle_name = middle_name, legal_first_name = legal_first_name, legal_last_name = legal_last_name
  where first_name <> tidy_name(first_name) or middle_name <> tidy_name(middle_name)
     or legal_first_name <> tidy_name(legal_first_name) or legal_last_name <> tidy_name(legal_last_name);
update public.parents set first_name = first_name, last_name = last_name
  where first_name <> tidy_name(first_name) or last_name <> tidy_name(last_name);
update public.staff set first_name = first_name, last_name = last_name
  where first_name <> tidy_name(first_name) or last_name <> tidy_name(last_name);

-- Who added the two students added through the app on 30 Sept 2026, from
-- Supabase's request logs (both by sro@, Victory NNAMOKO).
update public.students set created_at = '2026-09-30 13:43:52+00', created_by = 'a80718bb-53a6-4d8a-a21f-ad4f1479af66'
  where student_id = 648 and created_by is null;
update public.students set created_at = '2026-09-30 13:46:00+00', created_by = 'a80718bb-53a6-4d8a-a21f-ad4f1479af66'
  where student_id = 650 and created_by is null;
