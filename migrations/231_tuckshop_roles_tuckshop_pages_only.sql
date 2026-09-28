-- 231_tuckshop_roles_tuckshop_pages_only.sql
--
-- The tuckshop and tuckshop_owner roles open the tuckshop pages and nothing
-- else.
--
-- Found on Mon 28 Sep 2026 when the principal asked what giving someone the
-- tuckshop role grants: besides the eight /tuckshop pages it also opened 15
-- unrelated ones (Attendance, Behaviour, Students, Results and Enter
-- Results, report writing, Detentions, the Parent Portal and more). They
-- were presumably added because the only tuckshop holder, Uju MAXWELL, is
-- also a house parent. Migration 229 then copied the whole list to
-- tuckshop_owner. The principal asked for both roles to be trimmed to the
-- tuckshop pages.
--
-- Nobody loses a page. Uju MAXWELL's houseparent role grants all 15 of the
-- removed pages (checked before this ran), and Uju MBA, the only
-- tuckshop_owner, is an admin. These are page grants only. What the roles
-- can do to data is decided by RLS and the tuckshop functions, which this
-- doesn't touch. The deletions are logged in change_history ('access').
--
-- Already applied to the live database through the Supabase connector on
-- 28 Sep 2026; this file records it.

set local formwork.change_note = 'Principal (direct)';

delete from public.role_permissions
where role_name in ('tuckshop', 'tuckshop_owner')
  and resource_key not like '/tuckshop/%';
