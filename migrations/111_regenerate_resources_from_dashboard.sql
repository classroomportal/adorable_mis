-- Migration 111: regenerate resources/role_permissions to match the real dashboard
--
-- resources/role_permissions (migration 046, touched once more in 053) was
-- seeded early and never kept in sync with app/page.js's TABS array, which
-- has since grown from 3 sections to 12 tiles with 60+ distinct hrefs
-- (Pastoral, Reports, Communication, Timetable, Assessment, Fees & Bills,
-- Tuckshop, Administration, plus many new items inside the original
-- sections). has_resource_access() / role_permissions was also never
-- actually called from app code (see docs/todo.md item 20) — /admin/permissions
-- was editing a table nothing read. Both problems together are why the
-- Permissions page looked incomplete and self-contradictory: most tiles
-- weren't listed, and the ones that were belonged to sections ("Admin",
-- "Whole School") that don't match any real tile name.
--
-- This migration replaces resources/role_permissions wholesale with a set
-- that mirrors every href currently reachable from app/page.js's TABS,
-- grouped under the tile label it actually appears on. Where a href is
-- reachable from more than one tile (e.g. /admin/block-allocation from
-- both Pastoral and Timetable), it gets exactly one row with the union of
-- roles that can reach it from any tile, since access is really per-page,
-- not per-tile.
--
-- Two deliberate restorations, not new judgment calls: assessment_manager/
-- assessment_user already had real grants here (migration 046) for
-- /admin/grade-boundaries, /assessments/import, /classes/progress etc, but
-- the Assessment tab has no `roles` array in TABS, so those roles have
-- never actually been able to reach it on the dashboard — restoring the
-- Assessment tab's `roles` array (in app/page.js, this same change) lets
-- those existing grants finally take effect. Likewise hr -> /staff/roles
-- and school_office -> /parents, /parents/import, /parents/welcome-emails,
-- /students/import were already granted in 046 and are carried forward
-- even though those tiles now live under an admin-only tab.
--
-- resources.resource_key cascades into role_permissions on delete (046),
-- so clearing resources is enough to clear both tables cleanly.

delete from resources;

insert into roles (role_name, description) values
  ('tuckshop', 'Sells tuckshop items, tops up balances, manages stock'),
  ('mentor', 'Form/mentor group tutor')
on conflict (role_name) do nothing;

-- 1. Resources: one row per unique href in app/page.js's TABS, section =
--    the tile label it's shown under (the primary one, where it appears on
--    more than one).
insert into resources (resource_key, label, section, sort_order) values
  ('/staff/timetable', 'My Timetable', 'Dashboard', 1),
  ('/parent-portal', 'My Children', 'Dashboard', 2),
  ('/calendar', 'Calendar', 'Dashboard', 3),
  ('/inbox', 'Inbox', 'Dashboard', 4),

  ('/students', 'Core Data', 'Students', 10),
  ('/behaviour', 'Behaviour Log', 'Students', 11),
  ('/behaviour/review', 'Review Serious Behaviour Events', 'Students', 12),
  ('/attendance', 'Attendance', 'Students', 13),
  ('/results', 'Results', 'Students', 14),
  ('/results/enter', 'Enter Results', 'Students', 15),
  ('/results/subject-overview', 'Subject Overview', 'Students', 16),
  ('/certificates', 'Certificates', 'Students', 17),
  ('/detention', 'Detention List', 'Students', 18),
  ('/appeals', 'Behaviour Appeals', 'Students', 19),

  ('/pastoral/registers-not-done', 'Registers Not Done', 'Pastoral', 20),
  ('/staff/mentor-groups', 'Mentor Groups', 'Pastoral', 21),
  ('/admin/block-allocation', 'Class Allocation', 'Pastoral', 22),

  ('/reports/write-subject-comments', 'Write Subject Comments', 'Reports', 30),
  ('/reports/write-pastoral-comments', 'Write Pastoral Comments', 'Reports', 31),
  ('/reports/check', 'Check Reports', 'Reports', 32),
  ('/reports/periods', 'Manage Report Periods', 'Reports', 33),
  ('/reports/generate', 'Generate Reports', 'Reports', 34),

  ('/comms/compose', 'Send Announcements to Parents / Groups', 'Communication', 40),
  ('/comms/history', 'Message History & Read Receipts', 'Communication', 41),

  ('/admin/import-classes', 'Import Nova-T Timetable', 'Timetable', 50),
  ('/admin/import-staff-commitments', 'Import Staff Commitments (NCLASS.DAT)', 'Timetable', 51),

  ('/results/import-gradebook', 'Import Weekly Results', 'Assessment', 60),
  ('/target-grades/import', 'Import Target Grades', 'Assessment', 61),
  ('/classes/progress', 'Class Progress', 'Assessment', 62),
  ('/admin/grade-boundaries', 'Grade Boundaries', 'Assessment', 63),
  ('/admin/subject-settings', 'Subject Settings', 'Assessment', 64),
  ('/assessments/import', 'Import CAT4/NGRT', 'Assessment', 65),

  ('/bursar/charge-checklist', 'Charge Checklist', 'Fees & Bills', 70),
  ('/bursar/fee-items', 'Fee Items (Prices)', 'Fees & Bills', 71),
  ('/bursar/discounts', 'Discounts', 'Fees & Bills', 72),
  ('/bursar/payments', 'Record a Payment', 'Fees & Bills', 73),
  ('/bursar/fees-table', 'All Students (Table)', 'Fees & Bills', 74),
  ('/bursar/debtors', 'Debtors List', 'Fees & Bills', 75),
  ('/bursar/audit', 'Audit', 'Fees & Bills', 76),
  ('/smt/fees-dashboard', 'SMT Dashboard', 'Fees & Bills', 77),

  ('/tuckshop/purchase', 'Sell Items', 'Tuckshop', 80),
  ('/tuckshop/topup', 'Top Up Balance', 'Tuckshop', 81),
  ('/tuckshop/balances', 'Balances', 'Tuckshop', 82),
  ('/tuckshop/preorders', 'Preorders', 'Tuckshop', 83),
  ('/tuckshop/items', 'Items & Prices', 'Tuckshop', 84),

  ('/staff/roles', 'Staff & Roles', 'Staff & Access', 90),
  ('/staff/import-emails', 'Bulk Import Staff Emails', 'Staff & Access', 91),
  ('/admin/permissions', 'Permissions', 'Staff & Access', 92),
  ('/admin/lookups', 'Lookups', 'Staff & Access', 93),
  ('/staff/welcome-emails', 'Send Staff Welcome Emails', 'Staff & Access', 94),
  ('/parents', 'Parents', 'Staff & Access', 95),
  ('/parents/welcome-emails', 'Send Parent Welcome Emails', 'Staff & Access', 96),
  ('/parents/import', 'Import Parents', 'Staff & Access', 97),

  ('/admin/register-alerts', 'Register Alerts', 'Administration', 100),
  ('/admin/student-numbers', 'Student Numbers by Gender', 'Administration', 101),
  ('/admin/class-lists', 'Class Lists (Print)', 'Administration', 102),
  ('/admin/print-timetables', 'Print Timetables (Print)', 'Administration', 103),

  ('/students/import', 'Import Students', 'Initial Setup', 110),
  ('/students/photos/import', 'Import Photos', 'Initial Setup', 111),
  ('/admin/import-timetable', 'Import Student Class Allocations', 'Initial Setup', 112);

-- 2. Grants. admin gets everything, matching current behaviour.
insert into role_permissions (role_name, resource_key)
select 'admin', resource_key from resources;

-- Universal tiles: Dashboard, and the non-admin parts of Students/Reports —
-- these tabs carry no adminOnly/roles gate in TABS today, so every staff
-- role reaches them.
insert into role_permissions (role_name, resource_key)
select r.role_name, res.resource_key
from roles r, resources res
where r.role_name <> 'admin'
  and res.resource_key in (
    '/staff/timetable', '/parent-portal', '/calendar', '/inbox',
    '/students', '/behaviour', '/attendance', '/results', '/results/enter',
    '/results/subject-overview', '/certificates', '/detention',
    '/reports/write-subject-comments', '/reports/write-pastoral-comments', '/reports/check'
  );

insert into role_permissions (role_name, resource_key) values
  ('school_office', '/behaviour/review'), ('hr', '/behaviour/review'),

  ('smt', '/appeals'), ('houseparent', '/appeals'), ('pastoral', '/appeals'),

  ('pastoral', '/pastoral/registers-not-done'), ('houseparent', '/pastoral/registers-not-done'), ('smt', '/pastoral/registers-not-done'),
  ('pastoral', '/staff/mentor-groups'), ('houseparent', '/staff/mentor-groups'), ('smt', '/staff/mentor-groups'),
  ('pastoral', '/admin/block-allocation'), ('head_of_department', '/admin/block-allocation'),

  ('smt', '/comms/compose'), ('pastoral', '/comms/compose'), ('school_office', '/comms/compose'),
  ('smt', '/comms/history'), ('pastoral', '/comms/history'), ('school_office', '/comms/history'),

  ('assessment_user', '/results/import-gradebook'), ('assessment_manager', '/results/import-gradebook'),
  ('assessment_user', '/target-grades/import'), ('assessment_manager', '/target-grades/import'),
  ('assessment_user', '/classes/progress'), ('assessment_manager', '/classes/progress'),
  ('teacher', '/classes/progress'), ('pastoral', '/classes/progress'), ('houseparent', '/classes/progress'), ('head_of_department', '/classes/progress'),
  ('assessment_manager', '/admin/grade-boundaries'),
  ('assessment_manager', '/admin/subject-settings'),
  ('assessment_manager', '/assessments/import'),

  ('bursar', '/bursar/charge-checklist'), ('smt', '/bursar/charge-checklist'),
  ('bursar', '/bursar/fee-items'), ('smt', '/bursar/fee-items'),
  ('bursar', '/bursar/discounts'), ('smt', '/bursar/discounts'),
  ('bursar', '/bursar/payments'), ('smt', '/bursar/payments'),
  ('bursar', '/bursar/fees-table'), ('smt', '/bursar/fees-table'),
  ('bursar', '/bursar/debtors'), ('smt', '/bursar/debtors'),
  ('bursar', '/bursar/audit'), ('smt', '/bursar/audit'),
  ('bursar', '/smt/fees-dashboard'), ('smt', '/smt/fees-dashboard'),

  ('tuckshop', '/tuckshop/purchase'), ('bursar', '/tuckshop/purchase'),
  ('tuckshop', '/tuckshop/topup'), ('bursar', '/tuckshop/topup'),
  ('tuckshop', '/tuckshop/balances'), ('bursar', '/tuckshop/balances'),
  ('tuckshop', '/tuckshop/preorders'), ('bursar', '/tuckshop/preorders'),
  ('tuckshop', '/tuckshop/items'), ('bursar', '/tuckshop/items'),

  ('hr', '/staff/roles'),
  ('hr', '/admin/lookups'), ('school_office', '/admin/lookups'),
  ('school_office', '/parents'),
  ('school_office', '/parents/welcome-emails'),
  ('school_office', '/parents/import'),

  ('hr', '/admin/register-alerts'), ('school_office', '/admin/register-alerts'),
  ('hr', '/admin/student-numbers'), ('school_office', '/admin/student-numbers'),
  ('hr', '/admin/class-lists'), ('school_office', '/admin/class-lists'),
  ('hr', '/admin/print-timetables'), ('school_office', '/admin/print-timetables'),

  ('school_office', '/students/import')
on conflict do nothing;
