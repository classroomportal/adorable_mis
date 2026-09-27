-- 219_history_names_and_notes.sql
--
-- Two gaps the principal spotted on the first real Change History entries
-- (27 Sep 2026):
--
-- 1. A change by a parent or student only said "parent account": the log
--    kept their login id, and SMT can't read other people's profiles to turn
--    it into a name. Both logs now store the person's name at the moment of
--    the change (changed_by_name): the staff member, parent or student the
--    login belongs to, or the login's email if it has no person. It's frozen
--    with the entry, so a later rename doesn't rewrite history. Change
--    History's "login" rows also now carry the account's name and email in
--    record_key, since profiles holds neither.
--
-- 2. Changes made through the Supabase database connection (how Claude
--    applies migrations, on the principal's authority) showed only "directly
--    in the database": the database sees a technical user, not a Formwork
--    sign-in. Both logs now copy a note from the session setting
--    formwork.change_note into a `note` column. Every migration applied that
--    way sets it first, as this one does (see CLAUDE.md):
--      set local formwork.change_note = 'Principal (direct)';
--    the wording the principal chose. It's a label, not proof: anyone with
--    database access could set any note. Signed-in changes ignore it; their
--    person comes from the session.
--
-- Rows already in the logs can't be updated (that's the point), so the two
-- entries from migration 218 keep "directly in the database" with no note.

set local formwork.change_note = 'Principal (direct)';

-- 1. New columns -----------------------------------------------------------------

alter table public.grade_history add column if not exists changed_by_name text;
alter table public.grade_history add column if not exists note text;
alter table public.change_history add column if not exists changed_by_name text;
alter table public.change_history add column if not exists note text;

-- 2. The name behind a login -----------------------------------------------------

create or replace function public.profile_display_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    nullif(trim(coalesce(st.first_name, '') || ' ' || coalesce(st.last_name, '')), ''),
    nullif(trim(coalesce(pa.first_name, '') || ' ' || coalesce(pa.last_name, '')), ''),
    nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), ''),
    u.email
  )
  from profiles p
  left join staff st on st.staff_id = p.staff_id
  left join parents pa on pa.parent_id = p.parent_id
  left join students s on s.student_id = p.student_id
  left join auth.users u on u.id = p.id
  where p.id = p_profile_id;
$$;

revoke execute on function public.profile_display_name(uuid) from public, anon, authenticated;

-- 3. Grade history writer, now with name and note -------------------------------

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

-- 4. Change history writer, now with name and note ------------------------------

create or replace function public.log_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
$$;
