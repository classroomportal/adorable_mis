-- 218_change_history.sql
--
-- A permanent, append-only log of changes to the records where a quiet edit
-- could hide something, agreed with the school 27 Sep 2026 after the grade
-- history (migration 215) went in. Same design as grade_history, one table
-- for all of them:
--
--   Registers    attendance: changes and deletions only. Taking a register
--                is the normal daily insert and isn't logged; changing a
--                mark afterwards (absent -> present) is what matters.
--   Fees         invoice_line_items (a deleted charge makes money vanish),
--                student_discounts, fee_discount_types, fee_items: every
--                insert, change and delete. fee_payments and
--                student_invoices: changes and deletions only (payments
--                can't be edited through the app at all, so any entry there
--                came from outside it).
--   Behaviour    behaviour_events: changes and deletions. The older
--                behaviour_event_audit only saw edits made through
--                edit_behaviour_event(); points, type, voiding and deletes
--                made any other way left no trace.
--   Access       staff_roles, role_permissions, profiles: every insert,
--                change and delete, so "gave myself bursar, took it away
--                again" leaves a trace.
--   Parent links student_parent: every insert, change and delete. A link
--                decides who sees a child's grades, behaviour and fees.
--
-- Who did it comes from the signed-in session (auth.uid() and that user's
-- staff_id), never from a column the page sent. Database-side changes (SQL
-- editor, cron) have no session: changed_by is null and db_user names the
-- role. Updates that change nothing (a register re-saved unchanged) are
-- skipped.
--
-- The log can't be edited: only the SECURITY DEFINER trigger writes it, API
-- roles get SELECT only, and a trigger rejects UPDATE, DELETE and TRUNCATE
-- from anyone, including an admin in the SQL editor. SMT and admins can
-- read it (at /admin/change-history). The bursar is deliberately not given
-- the fee history: it exists partly to check fee changes.

create table if not exists public.change_history (
  id bigint generated always as identity primary key,
  area text not null check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links')),
  table_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  record_key jsonb not null,
  student_id integer,
  changed_fields text[],
  old_row jsonb,
  new_row jsonb,
  changed_by uuid,
  changed_by_staff_id integer,
  changed_by_role text,
  db_user text not null default current_user,
  changed_at timestamptz not null default now()
);

comment on table public.change_history is
  'Append-only log of changes to registers, fees, behaviour, access (roles, permissions, logins) and parent links. '
  'Written only by log_change(); cannot be updated or deleted.';

create index if not exists change_history_area_idx on public.change_history (area, changed_at desc);
create index if not exists change_history_student_idx on public.change_history (student_id, changed_at desc);
create index if not exists change_history_changed_by_idx on public.change_history (changed_by_staff_id, changed_at desc);
create index if not exists change_history_changed_at_idx on public.change_history (changed_at desc);

alter table public.change_history enable row level security;

revoke all on public.change_history from public, anon, authenticated;
grant select on public.change_history to authenticated;

drop policy if exists change_history_read on public.change_history;
create policy change_history_read on public.change_history
  for select to authenticated
  using (user_has_staff_role(array['smt']));

-- 1. Nothing may change or remove a log row ----------------------------------

create or replace function public.change_history_is_append_only()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  raise exception 'change_history is a permanent record: rows cannot be changed or deleted'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke execute on function public.change_history_is_append_only() from public, anon, authenticated;

drop trigger if exists trg_change_history_no_update_delete on public.change_history;
create trigger trg_change_history_no_update_delete
  before update or delete on public.change_history
  for each row execute function public.change_history_is_append_only();

drop trigger if exists trg_change_history_no_truncate on public.change_history;
create trigger trg_change_history_no_truncate
  before truncate on public.change_history
  for each statement execute function public.change_history_is_append_only();

-- 2. The logging trigger ------------------------------------------------------
--
-- TG_ARGV[0] is the area, TG_ARGV[1] the primary-key column(s), comma-separated.

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

  v_student := (v_row->>'student_id')::integer;
  if v_student is null and v_row ? 'invoice_id' then
    select si.student_id into v_student from student_invoices si where si.id = (v_row->>'invoice_id')::bigint;
  end if;

  select p.staff_id, p.role into v_staff_id, v_role from profiles p where p.id = auth.uid();

  insert into change_history (
    area, table_name, action, record_key, student_id, changed_fields,
    old_row, new_row, changed_by, changed_by_staff_id, changed_by_role
  ) values (
    tg_argv[0], tg_table_name, tg_op, v_key, v_student, v_changed,
    v_old, v_new, auth.uid(), v_staff_id, v_role
  );

  return coalesce(new, old);
end;
$$;

revoke execute on function public.log_change() from public, anon, authenticated;

-- 3. Attach it ------------------------------------------------------------------

-- Registers: changes and deletions only.
drop trigger if exists trg_log_change on public.attendance;
create trigger trg_log_change after update or delete on public.attendance
  for each row execute function public.log_change('registers', 'attendance_id');

-- Fees.
drop trigger if exists trg_log_change on public.invoice_line_items;
create trigger trg_log_change after insert or update or delete on public.invoice_line_items
  for each row execute function public.log_change('fees', 'id');
drop trigger if exists trg_log_change on public.student_discounts;
create trigger trg_log_change after insert or update or delete on public.student_discounts
  for each row execute function public.log_change('fees', 'id');
drop trigger if exists trg_log_change on public.fee_discount_types;
create trigger trg_log_change after insert or update or delete on public.fee_discount_types
  for each row execute function public.log_change('fees', 'id');
drop trigger if exists trg_log_change on public.fee_items;
create trigger trg_log_change after insert or update or delete on public.fee_items
  for each row execute function public.log_change('fees', 'id');
drop trigger if exists trg_log_change on public.fee_payments;
create trigger trg_log_change after update or delete on public.fee_payments
  for each row execute function public.log_change('fees', 'id');
drop trigger if exists trg_log_change on public.student_invoices;
create trigger trg_log_change after delete on public.student_invoices
  for each row execute function public.log_change('fees', 'id');

-- Behaviour: changes and deletions.
drop trigger if exists trg_log_change on public.behaviour_events;
create trigger trg_log_change after update or delete on public.behaviour_events
  for each row execute function public.log_change('behaviour', 'event_id');

-- Access.
drop trigger if exists trg_log_change on public.staff_roles;
create trigger trg_log_change after insert or update or delete on public.staff_roles
  for each row execute function public.log_change('access', 'staff_id,role_name');
drop trigger if exists trg_log_change on public.role_permissions;
create trigger trg_log_change after insert or update or delete on public.role_permissions
  for each row execute function public.log_change('access', 'role_name,resource_key');
drop trigger if exists trg_log_change on public.profiles;
create trigger trg_log_change after insert or update or delete on public.profiles
  for each row execute function public.log_change('access', 'id');

-- Parent links.
drop trigger if exists trg_log_change on public.student_parent;
create trigger trg_log_change after insert or update or delete on public.student_parent
  for each row execute function public.log_change('parent_links', 'student_id,parent_id');

-- 4. The page -----------------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/admin/change-history', 'Change History', 'Administration', 95)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/admin/change-history'
from unnest(array['admin', 'smt']) as r
on conflict do nothing;
