-- 234_view_as_parent_resource.sql
--
-- Adds the /parents/view-as page ("View as Parent") to /admin/permissions.
--
-- The principal asked on 28 Sep 2026 for a way to see the parent portal as a
-- parent sees it. Until now the only way was a staff login that is also
-- linked as a parent (cs@), and that showed more than a parent sees: staff
-- read behaviour through the staff policy, so incidents hidden from parents
-- appeared too (fixed in the app, PR #221). The new page renders the same
-- portal for any chosen parent, applying the parent-only filters in the page.
--
-- No new data access: the page reads through the viewer's own login, so it
-- only shows what they can already read. Granted to the roles that can
-- already read parent records (admin, smt, school_office); admins can add
-- others at /admin/permissions.
--
-- Applied to the live database through the Supabase connector on
-- 28 Sep 2026; this file records it.

set local formwork.change_note = 'Principal (direct)';

insert into public.resources (resource_key, label, section, sort_order)
values ('/parents/view-as', 'View as Parent', 'Staff & Access', 96)
on conflict (resource_key) do update set
  label = excluded.label,
  section = excluded.section,
  sort_order = excluded.sort_order;

insert into public.role_permissions (role_name, resource_key)
select r, '/parents/view-as' from unnest(array['admin', 'smt', 'school_office']) as r
on conflict do nothing;
