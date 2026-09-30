-- Migration 293: the Staff and Behaviour alerts numbers move onto their
-- cards.
--
-- Why: following 292 (active students onto the Students card), the principal
-- (30 Sept 2026) asked for the staff number to sit on the Staff & Access card
-- and the behaviour alerts number on the Pastoral card, in the same style.
-- Row 2 of the staff dashboard is now Log behaviour and, for staff who are
-- also parents, My Children. The numbers are drawn in app/page.js
-- (CARD_COUNTS); this only removes their saved row-2 positions. Data only.

set local formwork.change_note = 'Principal (direct)';

delete from public.dashboard_tile_order
where dashboard = 'staff_stats' and tile_key in ('staff', 'alerts');

update public.dashboard_tile_order set position = 1
where dashboard = 'staff_stats' and tile_key = 'my_children';
