-- Migration 413: a Targets & Baselines card on the staff dashboard.
--
-- Why: the principal, 8 Oct 2026, tidying the Assessment card (which had
-- six links all called some kind of "Results"): "Targets and baselines is
-- good". Import CAT4/NGRT, Reading Ages, Add Reading Test and Import Targets
-- (the information targets are set from, then the targets themselves) come
-- off the Assessment card onto a new card, key 'targets'. Assessment keeps
-- the numbered marks links, Grade Boundaries, Subject Settings and Grade
-- History. Who can open each page is unchanged; the card shows only the
-- links a person already has.
--
-- How: the card goes straight after Assessment in the saved staff_modules
-- order; the later cards move down one. It can be moved at /admin/tile-order.
-- Without a row it would sit at the end.

set local formwork.change_note = 'Principal (direct)';

update public.dashboard_tile_order
   set position = position + 1
 where dashboard = 'staff_modules'
   and position > (select position from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'assessment')
   and not exists (select 1 from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'targets');

insert into public.dashboard_tile_order (dashboard, tile_key, position)
select 'staff_modules', 'targets', position + 1
  from public.dashboard_tile_order
 where dashboard = 'staff_modules' and tile_key = 'assessment'
on conflict do nothing;
