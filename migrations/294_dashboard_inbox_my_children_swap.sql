-- Migration 294: Inbox moves to row 2, My Children to row 1.
--
-- Why: the principal (30 Sept 2026) asked for the Inbox tile to move from
-- the staff dashboard's top row to row 2, beside Log behaviour, and for My
-- Children (staff who are also parents) to move up to the top row. The tiles
-- are drawn in app/page.js and listed in lib/tileOrder.js; this only moves
-- their saved positions. Row 1: My Timetable, Calendar, My Children. Row 2:
-- Log behaviour, Inbox. Data only.

set local formwork.change_note = 'Principal (direct)';

delete from public.dashboard_tile_order
where (dashboard = 'staff' and tile_key = 'inbox')
   or (dashboard = 'staff_stats' and tile_key = 'my_children');

insert into public.dashboard_tile_order (dashboard, tile_key, position)
values ('staff', 'timetable', 0), ('staff', 'calendar', 1), ('staff', 'my_children', 2),
       ('staff_stats', 'log_behaviour', 0), ('staff_stats', 'inbox', 1)
on conflict (dashboard, tile_key) do update set position = excluded.position;
