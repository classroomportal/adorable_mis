-- Migration 329: tickable role abilities, stage 1 (Certificates, Sick bay,
-- grade boundaries).
--
-- Why (the principal, 2 Oct 2026): "In an ideal world we should be able to
-- tick and untick abilities." Design and decisions: docs/role-abilities-design.md.
-- Until now what a role could view, add, edit or delete was written into each
-- table's RLS policies by role name, so changing it needed a migration. From
-- here a converted table's policies ask has_ability(table, action), which reads
-- the ticks in role_abilities, set by admins at /admin/permissions through
-- set_role_ability() (logged in Change History under "access").
--
-- This stage converts:
--   * certificate_levels: add/edit/delete were "has /admin/lookups"
--     (admin, smt, hr). Viewing stays open to everyone signed in (locked).
--   * certificates_awarded: every staff member could do everything; ticked
--     for every role. (The one staff login with no role, networkofficer@,
--     opens no pages and loses nothing it uses.)
--   * the seven sick-bay tables: nurse and admin (is_medical_staff()).
--   * bmi_for_age_reference: admin writes; everyone signed in reads (locked).
--   * subject_grade_boundaries: the principal, 2 Oct 2026: only assessment
--     managers edit grade boundaries. Until now any member of staff could
--     (the school's decision of 27 Sept 2026, now replaced). Ticked for
--     assessment_manager only; an admin can tick more. Viewing stays open to
--     everyone signed in, because students and parents see grades (locked).
-- Each table gets exactly today's access in ticks, except grade boundaries.
--
-- The principal's decisions that must never be tickable are seeded as locks
-- now, so the page shows their padlocks: only the school office adds
-- students; Grade History and Change History can't be edited; fee prices need
-- the principal and the college secretary. (Parents never seeing homework
-- marks or other students' names is not a staff tick at all, and the triggers
-- that enforce it are untouched.) Locks have no write grant: they change only
-- by a migration agreed with the principal.
--
-- Functions that are SECURITY DEFINER (merge_subjects, the clinic views) keep
-- their own checks; the ticks govern what a role can do to the table directly.

set local formwork.change_note = 'Principal (direct)';

-- ---------------------------------------------------------------- tables

create table public.role_abilities (
  id bigint generated always as identity primary key,
  role_name text not null references public.roles(role_name) on delete cascade,
  table_name text not null,
  action text not null check (action in ('view', 'add', 'edit', 'delete')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index role_abilities_role_table_action on public.role_abilities (role_name, table_name, action);
create index role_abilities_table_action on public.role_abilities (table_name, action);
alter table public.role_abilities enable row level security;
grant select on public.role_abilities to authenticated;
create policy role_abilities_read on public.role_abilities for select to authenticated using (true);
create trigger trg_log_change after insert or update or delete on public.role_abilities
  for each row execute function log_change('access', 'role_name,table_name,action');

-- Which tables are converted, i.e. tickable on the page.
create table public.role_ability_tables (
  table_name text primary key,
  stage integer not null,
  converted_on date not null default current_date
);
alter table public.role_ability_tables enable row level security;
grant select on public.role_ability_tables to authenticated;
create policy role_ability_tables_read on public.role_ability_tables for select to authenticated using (true);

-- Cells nobody can tick, with the reason shown on the page.
create table public.role_ability_locks (
  table_name text not null,
  action text not null check (action in ('view', 'add', 'edit', 'delete')),
  reason text not null,
  primary key (table_name, action)
);
alter table public.role_ability_locks enable row level security;
grant select on public.role_ability_locks to authenticated;
create policy role_ability_locks_read on public.role_ability_locks for select to authenticated using (true);

-- ---------------------------------------------------------------- functions

-- True if any role the caller holds is ticked for this action on this table.
-- An admin login counts as holding the admin role.
create or replace function public.has_ability(p_table text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from profiles p
    join role_abilities ra on ra.table_name = p_table and ra.action = p_action
    where p.id = auth.uid()
      and ((ra.role_name = 'admin' and p.role = 'admin')
           or exists (select 1 from staff_roles sr
                      where sr.staff_id = p.staff_id and sr.role_name = ra.role_name))
  );
$$;
revoke execute on function public.has_ability(text, text) from public, anon;
grant execute on function public.has_ability(text, text) to authenticated;

-- Who would gain or lose the ability: people holding the role who don't
-- already have it through another role. Admins only.
create or replace function public.role_ability_preview(p_role text, p_table text, p_action text)
returns table (name text, email text, other_roles text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'Only admins can change abilities';
  end if;
  return query
    select profile_display_name(p.id), p.email::text,
           (select string_agg(sr2.role_name, ', ' order by sr2.role_name)
              from staff_roles sr2 where sr2.staff_id = p.staff_id and sr2.role_name <> p_role)
    from profiles p
    where (exists (select 1 from staff_roles sr where sr.staff_id = p.staff_id and sr.role_name = p_role)
           or (p_role = 'admin' and p.role = 'admin'))
      and not exists (
        select 1 from role_abilities ra
        where ra.table_name = p_table and ra.action = p_action and ra.role_name <> p_role
          and ((ra.role_name = 'admin' and p.role = 'admin')
               or exists (select 1 from staff_roles sr where sr.staff_id = p.staff_id and sr.role_name = ra.role_name)))
    order by 1;
end;
$$;
revoke execute on function public.role_ability_preview(text, text, text) from public, anon;
grant execute on function public.role_ability_preview(text, text, text) to authenticated;

-- The only way to tick or untick. Admins only; converted tables only; never
-- a locked cell; admin can't take away its own access to permissions.
create or replace function public.set_role_ability(p_role text, p_table text, p_action text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  if not is_admin() then
    raise exception 'Only admins can change abilities';
  end if;
  if not exists (select 1 from roles where role_name = p_role) then
    raise exception 'No such role: %', p_role;
  end if;
  if p_action not in ('view', 'add', 'edit', 'delete') then
    raise exception 'No such action: %', p_action;
  end if;
  select reason into v_reason from role_ability_locks where table_name = p_table and action = p_action;
  if v_reason is not null then
    raise exception 'This can''t be changed here: %', v_reason;
  end if;
  if not exists (select 1 from role_ability_tables where table_name = p_table) then
    raise exception 'Abilities on % aren''t tickable yet', p_table;
  end if;
  if p_role = 'admin' and not p_on
     and p_table in ('role_abilities', 'role_permissions', 'resources', 'roles', 'role_ability_tables', 'role_ability_locks') then
    raise exception 'Admin can''t remove its own access to permissions';
  end if;

  if p_on then
    insert into role_abilities (role_name, table_name, action)
    values (p_role, p_table, p_action)
    on conflict (role_name, table_name, action) do nothing;
  else
    delete from role_abilities
    where role_name = p_role and table_name = p_table and action = p_action;
  end if;
end;
$$;
revoke execute on function public.set_role_ability(text, text, text, boolean) from public, anon;
grant execute on function public.set_role_ability(text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------- locks

insert into public.role_ability_locks (table_name, action, reason) values
  ('students', 'add', 'Only the school office adds students (the principal; migrations 275 and 328)'),
  ('grade_history', 'add', 'Grade History is a permanent log and can never be edited (the principal)'),
  ('grade_history', 'edit', 'Grade History is a permanent log and can never be edited (the principal)'),
  ('grade_history', 'delete', 'Grade History is a permanent log and can never be edited (the principal)'),
  ('grade_history', 'view', 'Who reads Grade History is fixed: SMT, assessment managers and admins (the principal)'),
  ('change_history', 'add', 'Change History is a permanent log and can never be edited (the principal)'),
  ('change_history', 'edit', 'Change History is a permanent log and can never be edited (the principal)'),
  ('change_history', 'delete', 'Change History is a permanent log and can never be edited (the principal)'),
  ('change_history', 'view', 'Who reads Change History is fixed: SMT and admins, never the bursar (the principal)'),
  ('fee_price_changes', 'add', 'Fee prices change only when the principal and the college secretary both approve (migration 259)'),
  ('fee_price_changes', 'edit', 'Fee prices change only when the principal and the college secretary both approve (migration 259)'),
  ('fee_price_changes', 'delete', 'Fee prices change only when the principal and the college secretary both approve (migration 259)'),
  ('fee_item_year_prices', 'add', 'Fee prices change only when the principal and the college secretary both approve (migration 259)'),
  ('fee_item_year_prices', 'edit', 'Fee prices change only when the principal and the college secretary both approve (migration 259)'),
  ('fee_item_year_prices', 'delete', 'Fee prices change only when the principal and the college secretary both approve (migration 259)'),
  ('certificate_levels', 'view', 'Everyone signed in reads certificate levels'),
  ('bmi_for_age_reference', 'view', 'Everyone signed in reads the BMI reference table'),
  ('subject_grade_boundaries', 'view', 'Everyone signed in reads grade boundaries: students and parents see grades worked out from them');

-- ---------------------------------------------------------------- ticks: today's access

insert into public.role_ability_tables (table_name, stage) values
  ('certificate_levels', 1), ('certificates_awarded', 1),
  ('student_medical', 1), ('student_medical_conditions', 1), ('student_clinic_visits', 1),
  ('student_immunisations', 1), ('student_growth_measurements', 1),
  ('student_medical_screenings', 1), ('student_screening_findings', 1),
  ('bmi_for_age_reference', 1), ('subject_grade_boundaries', 1);

-- certificate_levels: whoever had /admin/lookups (admins always did).
insert into public.role_abilities (role_name, table_name, action)
select distinct r.role_name, 'certificate_levels', a.action
from (select role_name from role_permissions where resource_key = '/admin/lookups'
      union select 'admin') r
cross join (values ('add'), ('edit'), ('delete')) a(action);

-- certificates_awarded: every staff role.
insert into public.role_abilities (role_name, table_name, action)
select r.role_name, 'certificates_awarded', a.action
from roles r cross join (values ('view'), ('add'), ('edit'), ('delete')) a(action);

-- Sick bay: nurse and admin.
insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, a.action
from (values ('nurse'), ('admin')) r(role_name)
cross join (values ('student_medical'), ('student_medical_conditions'), ('student_clinic_visits'),
                   ('student_immunisations'), ('student_growth_measurements'),
                   ('student_medical_screenings'), ('student_screening_findings')) t(table_name)
cross join (values ('view'), ('add'), ('edit'), ('delete')) a(action);

-- BMI reference: admin writes.
insert into public.role_abilities (role_name, table_name, action)
select 'admin', 'bmi_for_age_reference', a.action
from (values ('add'), ('edit'), ('delete')) a(action);

-- Grade boundaries: assessment managers only (the principal, 2 Oct 2026).
insert into public.role_abilities (role_name, table_name, action)
select 'assessment_manager', 'subject_grade_boundaries', a.action
from (values ('add'), ('edit'), ('delete')) a(action);

-- ---------------------------------------------------------------- policies

drop policy if exists "Certificate levels edited on Lookups" on public.certificate_levels;
drop policy if exists staff_delete_certificates on public.certificates_awarded;
drop policy if exists staff_insert_certificates on public.certificates_awarded;
drop policy if exists staff_read_certificates on public.certificates_awarded;
drop policy if exists staff_update_certificates on public.certificates_awarded;
drop policy if exists medical_staff_manage_student_medical on public.student_medical;
drop policy if exists medical_staff_manage_conditions on public.student_medical_conditions;
drop policy if exists medical_staff_manage_clinic_visits on public.student_clinic_visits;
drop policy if exists medical_staff_manage_immunisations on public.student_immunisations;
drop policy if exists medical_staff_manage_growth on public.student_growth_measurements;
drop policy if exists medical_staff_manage_screenings on public.student_medical_screenings;
drop policy if exists medical_staff_manage_screening_findings on public.student_screening_findings;
drop policy if exists admin_write_bmi_reference on public.bmi_for_age_reference;
drop policy if exists "staff manage grade boundaries" on public.subject_grade_boundaries;

-- One policy per ticked action. The subselect makes Postgres work
-- has_ability() out once per statement, not once per row.
do $$
declare
  t text;
  locked_view boolean;
begin
  foreach t in array array[
    'certificate_levels', 'certificates_awarded',
    'student_medical', 'student_medical_conditions', 'student_clinic_visits',
    'student_immunisations', 'student_growth_measurements',
    'student_medical_screenings', 'student_screening_findings',
    'bmi_for_age_reference', 'subject_grade_boundaries']
  loop
    locked_view := exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'view');
    if not locked_view then
      execute format('create policy ability_view on public.%I for select to authenticated using ((select has_ability(%L, ''view'')))', t, t);
    end if;
    execute format('create policy ability_add on public.%I for insert to authenticated with check ((select has_ability(%L, ''add'')))', t, t);
    execute format('create policy ability_edit on public.%I for update to authenticated using ((select has_ability(%L, ''edit''))) with check ((select has_ability(%L, ''edit'')))', t, t, t);
    execute format('create policy ability_delete on public.%I for delete to authenticated using ((select has_ability(%L, ''delete'')))', t, t);
  end loop;
end;
$$;
