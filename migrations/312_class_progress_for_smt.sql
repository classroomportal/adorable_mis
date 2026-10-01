-- Migration 312: Class Progress for SMT, and SMT always see every class.
--
-- Why (the principal, 1 Oct 2026): Class Progress becomes a big tile on the
-- top row of the staff dashboard, where "HOD only see their department
-- classes while smt see all". SMT didn't have the page at all, so it is
-- granted here. The page narrows itself to a department through
-- my_department_scope(), which returned the department of anyone holding a
-- department-scoped head_of_department role, so a member of SMT who is also a
-- Head of Department would have seen only their department. SMT now get no
-- scope (every class). my_department_scope() is used only by Class Progress.
-- It narrows what the page shows; it is not a security boundary (results are
-- readable by staff under their own policies).

set local formwork.change_note = 'Principal (direct)';

insert into public.role_permissions (role_name, resource_key) values
  ('smt', '/classes/progress')
on conflict do nothing;

create or replace function public.my_department_scope()
returns text
language sql
security definer
set search_path to 'public'
as $$
  select case when user_has_staff_role(array['smt']) then null else (
    select sr.scope_value
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid()
      and sr.role_name = 'head_of_department'
      and sr.scope_type = 'department'
    limit 1)
  end;
$$;
