-- Migration 368: put the Budget tile next to Fees & Bills.
--
-- Why: the principal, 5 Oct 2026: "Where is budget tile". The Budget card
-- (migration 341) was never added to the saved staff_modules order, so
-- sortTiles() put it after every listed card, at the very bottom of the
-- dashboard below Administration. It now sits straight after Fees & Bills;
-- the later cards move down one. It can still be moved at /admin/tile-order.

set local formwork.change_note = 'Principal (direct)';

update public.dashboard_tile_order
   set position = position + 1
 where dashboard = 'staff_modules'
   and position > (select position from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'fees')
   and not exists (select 1 from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'budget');

insert into public.dashboard_tile_order (dashboard, tile_key, position)
select 'staff_modules', 'budget', position + 1
  from public.dashboard_tile_order
 where dashboard = 'staff_modules' and tile_key = 'fees'
on conflict do nothing;
