-- Migration 369: the college secretary sees the Budget too.
--
-- Why: the principal, 5 Oct 2026: "Cs needs to see it". Until now only the
-- principal saw the Budget while it was being built (migration 338). The
-- college secretary costs and approves requisitions and approves budgets,
-- suppliers and fee prices with the principal, so she now gets the Budget
-- tile and all eight of its pages. Nothing else changes: what each of them
-- may do on those pages is still decided by finance_can_act() and the
-- approval functions; in Practice the principal can still do every step,
-- and clearing practice entries stays the principal's. The bursar and SMT
-- still don't see it (admin alone is not enough; cs@ holds the
-- college_secretary role itself).

set local formwork.change_note = 'Principal (direct)';

create or replace function public.can_view_budget()
returns boolean
language sql
stable security definer
set search_path = public, pg_temp
as $$
  select holds_staff_role('principal') or holds_staff_role('college_secretary');
$$;

insert into public.role_permissions (role_name, resource_key)
select 'college_secretary', r.resource_key
from public.role_permissions r
where r.role_name = 'principal' and r.resource_key like '/finance/%'
on conflict do nothing;
