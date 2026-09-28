-- 240_detention_list_follows_page_permission.sql
--
-- Pa2 (school office) couldn't see the detention list. Two things were wrong:
--
--   1. The detentions table's RLS policies (migration 085) let only
--      admin, smt, houseparent, head_of_boarding and pastoral read or update
--      rows, through is_pastoral_or_smt(). Meanwhile role_permissions had
--      given the /detention page to hr, admissions, mentor,
--      assessment_manager and assessment_user too. Those staff could open
--      the page but always saw an empty list, because the rows were
--      filtered out underneath them.
--   2. school_office didn't have /detention at all.
--
-- Now the read and update policies check has_resource_access('/detention'),
-- the same permission that decides who can open the page, so whoever is
-- given the page on /admin/permissions sees the list and can mark
-- attended/missed. The is_demo condition is kept as it was. school_office
-- gets /detention.
--
-- Applied to the live database through the Supabase connector on
-- 28 Sep 2026; this file records it.

set local formwork.change_note = 'Principal (direct)';

drop policy if exists pastoral_read_detentions on public.detentions;
drop policy if exists pastoral_update_detentions on public.detentions;

create policy detention_page_read_detentions on public.detentions
  for select
  using (has_resource_access('/detention') and ((is_demo = is_demo_account()) or is_admin()));

create policy detention_page_update_detentions on public.detentions
  for update
  using (has_resource_access('/detention') and ((is_demo = is_demo_account()) or is_admin()));

insert into public.role_permissions (role_name, resource_key)
select 'school_office', '/detention'
where not exists (
  select 1 from public.role_permissions
  where role_name = 'school_office' and resource_key = '/detention'
);
