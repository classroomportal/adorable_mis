-- Migration 292: Log behaviour moves to row 2; active students onto the
-- Students card.
--
-- Why: the principal (30 Sept 2026) asked for the "Active students" number
-- tile to come off the staff dashboard's second row, with the same number
-- shown as a link on the Students card instead, and for the Log behaviour
-- tile to move from row 1 to row 2. The tiles themselves are in app/page.js
-- and lib/tileOrder.js; this only moves their saved positions so
-- /admin/tile-order starts from the new layout: row 1 is My Timetable,
-- Calendar, Inbox; row 2 is Log behaviour first, then Staff, Behaviour
-- alerts and My Children. Data only; no table changes.

set local formwork.change_note = 'Principal (direct)';

delete from public.dashboard_tile_order
where (dashboard = 'staff' and tile_key = 'log_behaviour')
   or (dashboard = 'staff_stats' and tile_key = 'students');

update public.dashboard_tile_order set position = case tile_key
    when 'timetable' then 0 when 'calendar' then 1 when 'inbox' then 2 end
where dashboard = 'staff' and tile_key in ('timetable', 'calendar', 'inbox');

update public.dashboard_tile_order set position = case tile_key
    when 'staff' then 1 when 'alerts' then 2 when 'my_children' then 3 end
where dashboard = 'staff_stats' and tile_key in ('staff', 'alerts', 'my_children');

insert into public.dashboard_tile_order (dashboard, tile_key, position)
values ('staff_stats', 'log_behaviour', 0)
on conflict (dashboard, tile_key) do update set position = excluded.position;
