-- 224_head_of_boarding_role.sql
--
-- Adds a `head_of_boarding` staff role for the staff who run boarding across
-- all the houses, above the houseparents.
--
-- Why a new role rather than renaming `head_of_department`: that role is held
-- by the heads of subject departments (Creative, Humanities, Languages, Maths)
-- with a department scope, and its pages are department pages. Renaming it
-- would have relabelled those four people and handed boarding staff their
-- pages.
--
-- What a head of boarding gets:
--   * Everything a houseparent can do. is_pastoral_or_smt() now includes the
--     role, which is what the detentions, appeals, parent-contact and
--     behaviour-edit policies and report_pastoral_grades() check. The app's
--     isPastoralOrSmt (lib/AuthContext.js) matches.
--   * Every house, not one. my_house_scope() only matches `houseparent` rows,
--     so a head of boarding has no house narrowing. One who is also a
--     houseparent of a house keeps that house as the default and can widen to
--     the whole school (my_house_scope_is_exclusive() counts the role as
--     cross-house).
--   * More of students' results than a houseparent: /classes/progress and
--     /results/top-ten on top of the houseparent's pages. Results, targets,
--     CAT4 and NGRT are already readable by every member of staff under RLS
--     (staff_read_results etc.), so this is page access, not a new grant.
--     Admins can change the page list at /admin/permissions as usual.
--
-- No new tables, so no grants. The role appears in /staff/roles from
-- lib/staffRoles.js.

set local formwork.change_note = 'Principal (direct)';

insert into public.roles (role_name, description) values
  ('head_of_boarding', 'Leads boarding across all houses; houseparent access for every house, plus Class Progress and Top Ten')
on conflict (role_name) do nothing;

create or replace function public.is_pastoral_or_smt()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select is_admin() or has_staff_role(array['smt', 'houseparent', 'head_of_boarding', 'pastoral']);
$$;

-- The live definition (migration 126, since changed live to use
-- my_mentee_ids()) with 'head_of_boarding' added to the roles that mean
-- day-to-day contact with students from other houses.
create or replace function public.my_house_scope_is_exclusive()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name = 'houseparent'
      and sr.scope_type = 'house'
  )
  and not exists (
    select 1
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name in (
        'admin', 'smt', 'hr', 'pastoral', 'teacher', 'head_of_department',
        'head_of_boarding', 'mentor', 'assessment_manager', 'assessment_user',
        'school_office', 'admissions'
      )
  )
  and not exists (
    select 1
    from profiles p
    join classes c on c.staff_id = p.staff_id
    where p.id = auth.uid()
  )
  and not exists (
    select 1 from my_mentee_ids()
  );
$$;

-- The houseparent's pages, plus the two results pages houseparents don't have.
insert into public.role_permissions (role_name, resource_key)
select 'head_of_boarding', resource_key
from public.role_permissions
where role_name = 'houseparent'
union
select 'head_of_boarding', r
from unnest(array['/classes/progress', '/results/top-ten']) as r
on conflict do nothing;
