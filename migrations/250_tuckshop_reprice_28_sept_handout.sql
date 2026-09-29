-- Re-price tuckshop orders handed out on 28 Sept 2026 at the item's current price.
--
-- Orders are charged when they are marked Given at /tuckshop/hand-out
-- (fulfill_tuckshop_preorder / give_tuckshop_order_edited -> record_tuckshop_purchase
-- reads tuckshop_items.price at that moment), which is what the school wants.
-- On 28 Sept the prices of Gala (item 31) and Pepsi (item 25) were changed in the
-- middle of the hand-out, so the first batches were charged the old prices:
-- 64 Galas at 175 instead of 250 (52 purchases, 51 students) and 2 Pepsis at 400
-- instead of 500. The school asked for every handed-out order to match the prices
-- as they are now, so this brings those lines to the current price and
-- recomputes the purchase totals that get_tuckshop_balance() subtracts.
--
-- Applied directly through the Supabase connector on 29 Sept 2026. Re-running it
-- is harmless: it only touches order lines that still differ from the current price.
-- Totals are recomputed in a second statement because CTEs in one statement all
-- read the same snapshot and would sum the old line totals.

set local formwork.change_note = 'Principal (direct)';

update tuckshop_purchase_items pi
set unit_price = i.price, line_total = i.price * pi.quantity
from tuckshop_items i, tuckshop_preorders o
where i.id = pi.tuckshop_item_id
  and o.purchase_id = pi.purchase_id
  and pi.unit_price <> i.price
  and pi.tuckshop_item_id in (25, 31);

update tuckshop_purchases p
set total_amount = t.s
from (select purchase_id, sum(line_total) as s from tuckshop_purchase_items group by 1) t
where t.purchase_id = p.id
  and p.total_amount <> t.s;
