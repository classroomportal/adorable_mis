-- Migration 046: Role-based permissions model
-- Adds a resources/role_permissions table pair so dashboard tiles (and
-- eventually page-level access) can be checked against a real permissions
-- grid instead of the handful of hardcoded isAdmin/isPastoralOrSmt checks
-- scattered through the app.
--
-- This migration is purely additive: it does not remove or change any
-- existing tables, RLS policies, or the staff_roles table already in use.

-- 1. Canonical list of roles. staff_roles.role_name stays free text for
--    backwards compatibility, but permissions are looked up against this
--    table so role names can't silently drift.
create table if not exists roles (
  role_name text primary key,
  description text
);

insert into roles (role_name, description) values
  ('smt', 'Senior Management Team'),
  ('hr', 'Manages staff details'),
  ('pastoral', 'Manages behaviour appeals and detention'),
  ('houseparent', 'Manages room and restaurant assignment; can be combined with teacher or pastoral'),
  ('assessment_manager', 'Manages grade boundaries, target grades, subject settings'),
  ('assessment_user', 'Imports results and target grades'),
  ('teacher', 'General teaching staff'),
  ('bursar', 'Fees and billing'),
  ('school_office', 'Edits student & parent core data, manages parent-student links'),
  ('admissions', 'Handles pre-enrolment applications'),
  ('admin', 'Full system access')
on conflict (role_name) do nothing;

-- 2. Resources: one row per dashboard tile / protected page. resource_key
--    matches the tile's href in app/page.js so the app can look up
--    permissions with a simple key, without hardcoding role logic per page.
create table if not exists resources (
  resource_key text primary key,
  label text not null,
  section text not null,
  sort_order int not null default 0
);

insert into resources (resource_key, label, section, sort_order) values
  ('/staff/timetable', 'My Timetable', 'Students', 1),
  ('/parent-portal', 'My Children', 'Students', 2),
  ('/students', 'Core Data', 'Students', 3),
  ('/behaviour', 'Behaviour', 'Students', 4),
  ('/attendance', 'Attendance', 'Students', 5),
  ('/results', 'Results', 'Students', 6),
  ('/classes/progress', 'Class Progress', 'Students', 7),
  ('/certificates', 'Certificates', 'Students', 8),
  ('/detention', 'Detention List', 'Students', 9),
  ('/appeals', 'Behaviour Appeals', 'Students', 10),
  ('/calendar', 'Calendar', 'Whole School', 20),
  ('/staff/roles', 'Staff & Roles', 'Admin', 30),
  ('/admin/permissions', 'Permissions', 'Admin', 31),
  ('/staff/welcome-emails', 'Send Staff Welcome Emails', 'Admin', 32),
  ('/admin/block-allocation', 'Class Allocation', 'Admin', 33),
  ('/parents', 'Parents', 'Admin', 34),
  ('/parents/welcome-emails', 'Send Parent Welcome Emails', 'Admin', 35),
  ('/students/import', 'Import Students', 'Admin', 36),
  ('/parents/import', 'Import Parents', 'Admin', 37),
  ('/results/import-gradebook', 'Import Weekly Results', 'Admin', 38),
  ('/target-grades/import', 'Import Target Grades', 'Admin', 39),
  ('/admin/grade-boundaries', 'Grade Boundaries', 'Admin', 40),
  ('/admin/subject-settings', 'Subject Settings', 'Admin', 41),
  ('/students/photos/import', 'Import Photos', 'Admin', 42),
  ('/assessments/import', 'Import CAT4/NGRT', 'Admin', 43),
  ('/admin/import-timetable', 'Import Timetable', 'Admin', 44),
  ('/admin/import-classes', 'Import Class/Teacher/Room', 'Admin', 45)
on conflict (resource_key) do nothing;

-- 3. The actual grants: which role can see which resource.
create table if not exists role_permissions (
  role_name text not null references roles(role_name) on delete cascade,
  resource_key text not null references resources(resource_key) on delete cascade,
  primary key (role_name, resource_key)
);

-- admin gets everything, matching current behaviour (isAdmin sees the whole Admin section).
insert into role_permissions (role_name, resource_key)
select 'admin', resource_key from resources
on conflict do nothing;

-- teacher: everyday student-facing tiles, no admin/import tiles.
insert into role_permissions (role_name, resource_key) values
  ('teacher', '/staff/timetable'),
  ('teacher', '/students'),
  ('teacher', '/behaviour'),
  ('teacher', '/attendance'),
  ('teacher', '/results'),
  ('teacher', '/classes/progress'),
  ('teacher', '/certificates'),
  ('teacher', '/calendar')
on conflict do nothing;

-- pastoral: teacher access plus appeals & detention.
insert into role_permissions (role_name, resource_key)
select 'pastoral', resource_key from role_permissions where role_name = 'teacher'
on conflict do nothing;
insert into role_permissions (role_name, resource_key) values
  ('pastoral', '/appeals'),
  ('pastoral', '/detention')
on conflict do nothing;

-- houseparent: same base as teacher for now. Room/restaurant assignment
-- tiles don't exist yet, so nothing extra to grant until those are built.
insert into role_permissions (role_name, resource_key)
select 'houseparent', resource_key from role_permissions where role_name = 'teacher'
on conflict do nothing;

-- assessment_user: results/target import only, plus everyday student view.
insert into role_permissions (role_name, resource_key) values
  ('assessment_user', '/results'),
  ('assessment_user', '/results/import-gradebook'),
  ('assessment_user', '/target-grades/import'),
  ('assessment_user', '/classes/progress'),
  ('assessment_user', '/calendar')
on conflict do nothing;

-- assessment_manager: everything assessment_user has, plus boundaries & subject settings.
insert into role_permissions (role_name, resource_key)
select 'assessment_manager', resource_key from role_permissions where role_name = 'assessment_user'
on conflict do nothing;
insert into role_permissions (role_name, resource_key) values
  ('assessment_manager', '/admin/grade-boundaries'),
  ('assessment_manager', '/admin/subject-settings'),
  ('assessment_manager', '/assessments/import')
on conflict do nothing;

-- hr: staff records only.
insert into role_permissions (role_name, resource_key) values
  ('hr', '/staff/roles'),
  ('hr', '/calendar')
on conflict do nothing;

-- bursar: fees tiles don't exist yet (see jobs list) — calendar only for now.
insert into role_permissions (role_name, resource_key) values
  ('bursar', '/calendar')
on conflict do nothing;

-- school_office: student/parent core data, parent-student links, comms.
insert into role_permissions (role_name, resource_key) values
  ('school_office', '/students'),
  ('school_office', '/students/import'),
  ('school_office', '/parents'),
  ('school_office', '/parents/import'),
  ('school_office', '/parents/welcome-emails'),
  ('school_office', '/calendar')
on conflict do nothing;

-- smt: broad read access across student-facing tiles plus appeals oversight.
insert into role_permissions (role_name, resource_key)
select 'smt', resource_key from resources where section in ('Students', 'Whole School')
on conflict do nothing;

-- admissions: nothing yet — the admissions module itself doesn't exist.
-- No grants until that's built (see jobs list).

-- 4. Helper function: does the current logged-in user have access to a
--    given resource_key? Checks the caller's staff_roles against
--    role_permissions. Admin role (profiles.role = 'admin') always passes,
--    matching current isAdmin behaviour.
create or replace function has_resource_access(p_resource_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
    or exists (
      select 1
      from profiles p
      join staff_roles sr on sr.staff_id = p.staff_id
      join role_permissions rp on rp.role_name = sr.role_name
      where p.id = auth.uid()
        and rp.resource_key = p_resource_key
    );
$$;

-- Everyone can read the resource/role tables (needed to render tile lists
-- client-side); only admin can edit them.
alter table roles enable row level security;
alter table resources enable row level security;
alter table role_permissions enable row level security;

create policy "roles readable by all authenticated" on roles
  for select using (auth.role() = 'authenticated');
create policy "resources readable by all authenticated" on resources
  for select using (auth.role() = 'authenticated');
create policy "role_permissions readable by all authenticated" on role_permissions
  for select using (auth.role() = 'authenticated');

create policy "roles editable by admin" on roles
  for all using (is_admin()) with check (is_admin());
create policy "resources editable by admin" on resources
  for all using (is_admin()) with check (is_admin());
create policy "role_permissions editable by admin" on role_permissions
  for all using (is_admin()) with check (is_admin());
