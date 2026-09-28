-- 233_tuckshop_hand_out_edit_order.sql
--
-- Hand Out Orders (/tuckshop/hand-out, migrations 228-230): the tuckshop
-- can give part of an order when some items aren't available, and the
-- student is charged only for what they actually got.
--
-- Asked for on Mon 28 Sep 2026: "The tuck shop lady needs to be able to
-- edit the order if some items were not available." Until now tapping a
-- student charged the whole order, so a student who ordered two Galas and
-- got one paid for two, with no way to put it right short of undoing the
-- order and leaving it not given.
--
-- How it works:
--   * give_tuckshop_order_edited() takes a student, a day and the quantity
--     of each item actually handed over. Each quantity must be between 0
--     and what the student ordered for that day: this is for items that
--     ran out, not for selling extra (Sell Items does that).
--   * The student's orders for the day are marked given, and one purchase
--     is recorded for just the quantities given, through
--     record_tuckshop_purchase() as every fulfilment is. The balance goes
--     down by that amount and nothing more.
--   * The order's own items (tuckshop_preorder_items) are left exactly as
--     the student placed them, so both what was ordered and what was given
--     (the purchase) stay on record. The page shows the difference.
--   * If nothing at all was available the order is still marked given,
--     with no purchase and nothing charged. Otherwise it would sit as "not
--     given" and "Mark all remaining as given" would charge it in full.
--   * An order that was already given can be edited too: its purchase is
--     removed first, exactly as Undo does (migration 228), then the new
--     quantities are charged. So a mistake is fixed in one step.
--   * The purchase is attached to the student's first order for the day
--     only. A student can have two orders for a day (one given, one added
--     later), and save_tuckshop_handout() adds up purchases through
--     tuckshop_preorders.purchase_id, which would count a shared purchase
--     twice. Undo already copes with orders that have no purchase.
--   * Same people and same checks as marking an order given (migration
--     230): tuckshop and tuckshop_owner only (has_staff_role(), which
--     admins don't pass for being admins), the per-student advisory lock
--     save_tuckshop_order() uses, and refused while the restaurant's list
--     for that day is saved.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.give_tuckshop_order_edited(
  p_student_id integer,
  p_for_date date,
  p_items jsonb
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order record;
  v_bad text;
  v_items jsonb;
  v_purchase_id bigint;
  v_first_order bigint;
begin
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can hand out orders';
  end if;

  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);
  if tuckshop_handout_locked(p_student_id, p_for_date) then
    raise exception 'This list has been saved, so it can''t be changed. Only the tuckshop owner can unlock it.';
  end if;

  select min(id) into v_first_order
  from tuckshop_preorders
  where student_id = p_student_id and for_date = p_for_date and status in ('pending', 'fulfilled');
  if v_first_order is null then
    raise exception 'This student has no order for that day';
  end if;

  -- What was given, one row per item, checked against what was ordered.
  with given as (
    select (x->>'item_id')::bigint as item_id, sum((x->>'quantity')::integer) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
    group by 1
  ),
  ordered as (
    select i.tuckshop_item_id as item_id, sum(i.quantity) as quantity
    from tuckshop_preorder_items i
    join tuckshop_preorders o on o.id = i.preorder_id
    where o.student_id = p_student_id and o.for_date = p_for_date and o.status in ('pending', 'fulfilled')
    group by 1
  )
  select coalesce(ti.name, 'item ' || g.item_id)
  into v_bad
  from given g
  left join ordered o on o.item_id = g.item_id
  left join tuckshop_items ti on ti.id = g.item_id
  where g.quantity is null or g.quantity < 0 or g.quantity > coalesce(o.quantity, 0)
  limit 1;
  if v_bad is not null then
    raise exception 'You can only give up to what was ordered (%)', v_bad;
  end if;

  select jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', quantity) order by item_id)
  into v_items
  from (
    select (x->>'item_id')::bigint as item_id, sum((x->>'quantity')::integer) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as x
    group by 1
  ) g
  where quantity > 0;

  -- Already given? Take the old charge off first, as Undo does.
  for v_order in
    select id, purchase_id from tuckshop_preorders
    where student_id = p_student_id and for_date = p_for_date and status = 'fulfilled'
  loop
    update tuckshop_preorders set status = 'pending', purchase_id = null where id = v_order.id;
    if v_order.purchase_id is not null then
      delete from tuckshop_purchase_items where purchase_id = v_order.purchase_id;
      delete from tuckshop_purchases where id = v_order.purchase_id;
    end if;
  end loop;

  if v_items is not null then
    v_purchase_id := record_tuckshop_purchase(p_student_id, v_items, auth.uid());
  end if;

  update tuckshop_preorders
  set status = 'fulfilled',
      purchase_id = case when id = v_first_order then v_purchase_id end
  where student_id = p_student_id and for_date = p_for_date and status = 'pending';

  return v_purchase_id;
end;
$function$;

comment on function public.give_tuckshop_order_edited(integer, date, jsonb) is
  'Tuckshop hand-out: mark a student''s orders for a day as given, charging only the quantities actually handed over ([{item_id, quantity}], each 0..ordered). Replaces any earlier charge for those orders. Returns the purchase id, or null if nothing was given.';

revoke execute on function public.give_tuckshop_order_edited(integer, date, jsonb) from public, anon;
grant execute on function public.give_tuckshop_order_edited(integer, date, jsonb) to authenticated;
