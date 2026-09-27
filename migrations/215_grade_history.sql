-- 215_grade_history.sql
--
-- A permanent, append-only history of every grade entered, changed or
-- deleted, so a corrected mistake (or a dishonest change) always leaves a
-- trace. Asked for 27 Sep 2026 to guard against internal fraud.
--
-- Covers the three grade tables: results (assessment marks and grades),
-- target_grades and transcript_grades. One row per change, with the old
-- and new grade, the whole old and new row, who did it and when.
--
-- Who did it comes from the signed-in session (auth.uid() and that user's
-- staff_id), never from a column the browser sent. results.staff_id and
-- transcript_grades.updated_by are written by the page, so they can't be
-- trusted to name the person who actually made the change. A change made
-- from the database side (the SQL editor, a cron job) has no session, so
-- changed_by is null and db_user says which database role ran it.
--
-- Inserts are logged too, not just updates and deletes: "who first entered
-- this grade" matters as much as who changed it, and results.staff_id can't
-- prove it. Updates that change nothing (an import re-upserting the same
-- value, or only updated_at moving) are skipped, so bulk imports don't
-- flood the history.
--
-- Why this can't be edited:
--   * the trigger that writes it is SECURITY DEFINER, and it is the only
--     writer: API roles get SELECT only (explicit grants, per CLAUDE.md) and
--     there are no insert/update/delete policies;
--   * a trigger on grade_history itself rejects every UPDATE, DELETE and
--     TRUNCATE, whoever runs it, including an admin in the SQL editor.
--     Only the database owner could get round that, by deliberately
--     dropping the trigger, which is itself a visible schema change.
-- Reading it: admins, SMT and assessment managers.

create table if not exists public.grade_history (
  id bigint generated always as identity primary key,
  table_name text not null check (table_name in ('results', 'target_grades', 'transcript_grades')),
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  student_id integer,
  subject_id integer,
  record_key jsonb not null,
  old_grade text,
  new_grade text,
  old_score numeric,
  new_score numeric,
  old_row jsonb,
  new_row jsonb,
  changed_by uuid,
  changed_by_staff_id integer,
  changed_by_role text,
  db_user text not null default current_user,
  changed_at timestamptz not null default now()
);

comment on table public.grade_history is
  'Append-only log of every insert, change and delete on results, target_grades and transcript_grades. '
  'Written only by log_grade_change(); cannot be updated or deleted.';

create index if not exists grade_history_student_idx on public.grade_history (student_id, changed_at desc);
create index if not exists grade_history_changed_by_idx on public.grade_history (changed_by_staff_id, changed_at desc);
create index if not exists grade_history_changed_at_idx on public.grade_history (changed_at desc);

alter table public.grade_history enable row level security;

-- Explicit grants: read-only for signed-in users (RLS narrows it further),
-- nothing for anon, and no write verbs for anyone through the API.
revoke all on public.grade_history from public, anon, authenticated;
grant select on public.grade_history to authenticated;

drop policy if exists grade_history_read on public.grade_history;
create policy grade_history_read on public.grade_history
  for select to authenticated
  using (user_has_staff_role(array['smt', 'assessment_manager']));

-- 1. Nothing may change or remove a history row ------------------------------

create or replace function public.grade_history_is_append_only()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'grade_history is a permanent record: rows cannot be changed or deleted'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.grade_history_is_append_only() from public, anon, authenticated;

drop trigger if exists trg_grade_history_no_update_delete on public.grade_history;
create trigger trg_grade_history_no_update_delete
  before update or delete on public.grade_history
  for each row execute function public.grade_history_is_append_only();

drop trigger if exists trg_grade_history_no_truncate on public.grade_history;
create trigger trg_grade_history_no_truncate
  before truncate on public.grade_history
  for each statement execute function public.grade_history_is_append_only();

-- 2. Record every change to a grade table ------------------------------------

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
    changed_by, changed_by_staff_id, changed_by_role
  ) values (
    tg_table_name, tg_op,
    (v_row->>'student_id')::integer, (v_row->>'subject_id')::integer, v_key,
    v_old->>v_grade_col, v_new->>v_grade_col,
    (v_old->>'score')::numeric, (v_new->>'score')::numeric,
    v_old, v_new,
    auth.uid(), v_staff_id, v_role
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function public.log_grade_change() from public, anon, authenticated;

drop trigger if exists trg_log_grade_change on public.results;
create trigger trg_log_grade_change
  after insert or update or delete on public.results
  for each row execute function public.log_grade_change();

drop trigger if exists trg_log_grade_change on public.target_grades;
create trigger trg_log_grade_change
  after insert or update or delete on public.target_grades
  for each row execute function public.log_grade_change();

drop trigger if exists trg_log_grade_change on public.transcript_grades;
create trigger trg_log_grade_change
  after insert or update or delete on public.transcript_grades
  for each row execute function public.log_grade_change();
