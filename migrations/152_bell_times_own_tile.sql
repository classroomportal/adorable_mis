-- Migration 152: Bell Times moves out of the Timetable tile onto a dashboard
-- tile of its own.
--
-- resources.section groups pages on /admin/permissions the same way the
-- dashboard groups them into tiles (migration 111), so it follows the page
-- to its new tile. Who can open it (role_permissions) is unchanged: admin.

update resources
   set section = 'Bell Times',
       label = 'Edit Bell Times'
 where resource_key = '/admin/bell-times';
