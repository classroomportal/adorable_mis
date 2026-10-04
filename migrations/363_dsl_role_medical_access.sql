-- Migration 363: a Designated Safeguarding Lead (dsl) role; medical records
-- for the relevant professionals only.
--
-- Why (the principal, 4 Oct 2026): "I need a dsl role. Admin can't see log.
-- Cs@ needs dsl role. She should be able to see and edit. Principal role only
-- needs view and I am not even sure about that. Medical details need to only
-- relevant professionals." Then, asked: all medical records, not just the
-- sick-bay log; cs@ gives up the nurse role; the principal role gets nothing;
-- padlock it so it can't be ticked back at /admin/permissions.
--
-- Until now the seven medical tables were ticked for nurse and admin
-- (migration 329), and the principal role had the Sick Bay Log page. After
-- this:
--   * nurse: view, add, edit, delete (unchanged).
--   * dsl:   view, add, edit. No delete. "Add" is included because the app
--            saves most edits as an upsert (the medical record card, the
--            height & weight round, screenings), which Postgres checks
--            against the insert rule as well; without it "edit" would fail
--            for any student who has no record yet.
--   * admin, principal and everyone else: nothing. has_ability() lets an
--     admin through only where 'admin' is ticked, so removing the ticks is
--     what shuts admins out. Admins still see the Clinic pages (admins see
--     every page) but no rows on them.
-- Every cell of the seven tables is padlocked: from now on who sees medical
-- records changes only by a migration agreed with the principal, so an
-- admin can't tick admin back in.

set local formwork.change_note = 'Principal (direct)';

-- 1. The role -------------------------------------------------------------

insert into public.roles (role_name, description) values
  ('dsl', 'Designated Safeguarding Lead — sees and edits student medical records')
on conflict (role_name) do nothing;

-- 2. Pages: the nurse's clinic pages and the student list to get to a
-- student's medical card. The principal role loses the Sick Bay Log.

insert into public.role_permissions (role_name, resource_key) values
  ('dsl', '/clinic'),
  ('dsl', '/clinic/visits'),
  ('dsl', '/clinic/measurements'),
  ('dsl', '/clinic/immunisations'),
  ('dsl', '/clinic/screenings'),
  ('dsl', '/students'),
  ('dsl', '/students/medical')
on conflict do nothing;

delete from public.role_permissions
where role_name = 'principal' and resource_key like '/clinic%';

-- 3. cs@: dsl in, nurse out.

insert into public.staff_roles (staff_id, role_name)
select s.staff_id, 'dsl' from public.staff s where lower(s.email) = 'cs@abc.sch.ng'
on conflict do nothing;

delete from public.staff_roles sr
using public.staff s
where s.staff_id = sr.staff_id and lower(s.email) = 'cs@abc.sch.ng' and sr.role_name = 'nurse';

-- 4. Ticks: admin off, dsl on.

delete from public.role_abilities
where role_name <> 'nurse'
  and table_name in ('student_medical', 'student_medical_conditions', 'student_clinic_visits',
                     'student_immunisations', 'student_growth_measurements',
                     'student_medical_screenings', 'student_screening_findings');

insert into public.role_abilities (role_name, table_name, action)
select 'dsl', t.table_name, a.action
from (values ('student_medical'), ('student_medical_conditions'), ('student_clinic_visits'),
             ('student_immunisations'), ('student_growth_measurements'),
             ('student_medical_screenings'), ('student_screening_findings')) t(table_name)
cross join (values ('view'), ('add'), ('edit')) a(action)
on conflict do nothing;

-- 5. Padlocks. The policies stay ability_view/add/edit/delete; the locks only
-- stop set_role_ability() changing the ticks.

insert into public.role_ability_locks (table_name, action, reason)
select t.table_name, a.action,
       'Medical records are for the nurse and the DSL only (the principal, 4 Oct 2026; migration 363)'
from (values ('student_medical'), ('student_medical_conditions'), ('student_clinic_visits'),
             ('student_immunisations'), ('student_growth_measurements'),
             ('student_medical_screenings'), ('student_screening_findings')) t(table_name)
cross join (values ('view'), ('add'), ('edit'), ('delete')) a(action)
on conflict (table_name, action) do update set reason = excluded.reason;

-- 6. is_medical_staff() no longer guards any policy, but it still let every
-- admin through (user_has_staff_role). Narrow it so nothing built on it
-- later reopens medical records to admins.

create or replace function public.is_medical_staff()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select has_staff_role(array['nurse', 'dsl']);
$$;
