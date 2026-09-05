-- Migration 051: Departments/Faculties + scoped role access
--
-- A subject belongs to exactly one department (confirmed). A staff role can
-- optionally carry a scope (scope_type + scope_value) — e.g. a
-- head_of_department row scoped to scope_type='department',
-- scope_value='Science' sees Class Progress data for Science subjects only.
-- An unscoped role (scope_type/value NULL) behaves exactly as today —
-- no change for existing roles.

-- 1. Departments
create table if not exists departments (
  department_name text primary key
);

insert into departments (department_name) values
  ('Science'), ('Maths'), ('Languages'), ('Creative'), ('Humanities')
on conflict do nothing;

-- 2. Each subject belongs to exactly one department (nullable — not every
-- subject needs assigning immediately).
alter table subjects add column if not exists department_name text
  references departments(department_name);

-- 3. Scope columns on staff_roles. NULL/NULL means "unscoped", i.e. today's
-- behaviour unchanged. A row can carry ONE scope — if a person needs a role
-- with two different scopes later, that's a schema change to revisit then.
alter table staff_roles add column if not exists scope_type text;
alter table staff_roles add column if not exists scope_value text;

-- 4. Restore head_of_department as its own role (migration 049 had folded
-- it into 'teacher'). Update the roles table and the staff_roles CHECK
-- constraint to include it again.
insert into roles (role_name, description) values
  ('head_of_department', 'Leads a department; sees Class Progress scoped to that department''s subjects')
on conflict (role_name) do nothing;

alter table staff_roles drop constraint if exists staff_roles_role_name_check;
alter table staff_roles add constraint staff_roles_role_name_check
  check (role_name = ANY (ARRAY[
    'admin', 'smt', 'hr', 'pastoral', 'houseparent',
    'assessment_manager', 'assessment_user', 'teacher',
    'bursar', 'school_office', 'admissions', 'head_of_department'
  ]::text[]));

-- head_of_department gets the same page-level access as teacher, plus
-- Class Progress (which teacher already has) — the department scoping
-- itself is enforced in the app, not by role_permissions, since it's a
-- data-level filter rather than a page-level grant.
insert into role_permissions (role_name, resource_key)
select 'head_of_department', resource_key from role_permissions where role_name = 'teacher'
on conflict do nothing;

-- 5. Helper: what department scope (if any) does the current user hold via
-- head_of_department? Returns NULL if unscoped or not a HoD, meaning "see
-- everything" — matches today's behaviour for everyone else.
create or replace function my_department_scope()
returns text
language sql
security definer
set search_path = public
as $$
  select sr.scope_value
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p.id = auth.uid()
    and sr.role_name = 'head_of_department'
    and sr.scope_type = 'department'
  limit 1;
$$;
