-- Migration 283: My Children moves from row 1 to row 2 of the staff dashboard.
--
-- Why: the principal asked (30 Sept 2026) for the My Children tile (staff who
-- are also parents) to sit with the numbers in row 2 rather than with the
-- everyday tiles in row 1. Its saved place moves with it: out of 'staff' and
-- to the end of 'staff_stats'. It can be rearranged at /admin/tile-order.

set local formwork.change_note = 'Principal (direct)';

delete from public.dashboard_tile_order where dashboard = 'staff' and tile_key = 'my_children';

insert into public.dashboard_tile_order (dashboard, tile_key, position)
select 'staff_stats', 'my_children', coalesce(max(position) + 1, 0)
from public.dashboard_tile_order where dashboard = 'staff_stats'
on conflict (dashboard, tile_key) do nothing;
