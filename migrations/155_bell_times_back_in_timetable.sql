-- Migration 155: Bell Times goes back under the Timetable tile.
--
-- Migration 152 gave it a dashboard tile of its own; the school would
-- rather find it with the rest of the timetable pages. resources.section
-- follows it back so /admin/permissions groups it the same way, and the
-- label returns to what 148 gave it.

update resources
   set section = 'Timetable',
       label = 'Bell Times'
 where resource_key = '/admin/bell-times';
