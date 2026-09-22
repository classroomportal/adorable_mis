-- Migration 129: give the Clinic its own dashboard tile.
--
-- Depends on migration 128 (the medical tables and the `nurse` role). Run
-- 128 first; on its own this only registers pages that would 404 on data.
--
-- Why a separate tile rather than items under Students or Pastoral: the
-- medical record card on /students/[id] answers "what about this child",
-- which is a question you arrive at from a student. The sick bay's own
-- questions — who has been seen today, who is still owed a follow-up, whose
-- parent has not been told, which jabs have fallen due — are whole-school
-- and are where the nurse *starts*, not where they end up. Those need a
-- front door of their own.
--
-- Tab visibility is entirely derived from these rows: app/page.js filters
-- every tile's items through hasAccess(), and ModuleCard hides a tile whose
-- item list comes back empty. So this migration is what makes the tile
-- appear, and only for the roles granted below — no code change needed to
-- move it later.

insert into resources (resource_key, label, section, sort_order) values
  ('/clinic',                'Sick Bay Dashboard',   'Clinic', 1),
  ('/clinic/visits',         'Sick Bay Log',         'Clinic', 2),
  ('/clinic/measurements',   'Height & Weight Round','Clinic', 3),
  ('/clinic/immunisations',  'Immunisations',        'Clinic', 4)
on conflict (resource_key) do nothing;

-- Same access decision as migration 128: the nurse, and admins via the
-- p.role = 'admin' branch in has_resource_access(). Widening this is a
-- deliberate act at /admin/permissions, not a default.
insert into role_permissions (role_name, resource_key) values
  ('nurse', '/clinic'),
  ('nurse', '/clinic/visits'),
  ('nurse', '/clinic/measurements'),
  ('nurse', '/clinic/immunisations')
on conflict do nothing;
