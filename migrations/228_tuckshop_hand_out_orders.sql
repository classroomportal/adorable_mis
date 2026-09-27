-- 228_tuckshop_hand_out_orders.sql
--
-- A quick way for the tuckshop to tick off students' orders as they're
-- handed over, restaurant by restaurant (/tuckshop/hand-out).
--
-- Asked for on Sun 27 Sep 2026: "We need a way of quickly noting that the
-- orders made by students have been supplied. The list needs to be by
-- restaurant." Until now the only way was /tuckshop/preorders, one long
-- list of cards in date order with no restaurants, and the Given column on
-- the order sheets is read-only. None of the 226 orders for Sat 26 Sep had
-- been marked.
--
-- Marking an order given does what "Fulfil" on /tuckshop/preorders always
-- has: fulfill_tuckshop_preorder() records a tuckshop purchase for it, so
-- the student's balance goes down by the order's value, and the order
-- becomes 'fulfilled'. Nothing new is invented about money here.
--
-- What is new is undo. A mis-tap on a phone at the counter would otherwise
-- charge a student with no way back except deleting rows by hand. Undoing
-- deletes the purchase that the fulfilment created (tuckshop_preorders
-- .purchase_id, so never a counter sale) and puts the order back to
-- 'pending'. Balances are worked out from top-ups minus purchases, so that
-- refunds the charge exactly.
--
-- One function does both, for a list of students on one tuckshop day, so
-- "mark everyone in this restaurant" is a single call rather than dozens.
-- It works per student rather than per order because save_tuckshop_order()
-- keeps one pending order per student per day, and the page shows students.
-- Tuckshop and bursar only, as with fulfill_tuckshop_preorder(); the actor
-- on the purchase is stamped from auth.uid() by stamp_actor().

set local formwork.change_note = 'Principal (direct)';

create or replace function public.set_tuckshop_orders_given(
  p_student_ids integer[],
  p_for_date date,
  p_given boolean
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order record;
  v_count integer := 0;
  v_student integer;
begin
  if not user_has_staff_role(array['tuckshop', 'bursar']) then
    raise exception 'Only tuckshop staff can mark orders as given';
  end if;

  -- Same lock as save_tuckshop_order(), so an order can't be changed while
  -- it's being charged.
  for v_student in select distinct s from unnest(coalesce(p_student_ids, '{}')) as s order by s
  loop
    perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), v_student);
  end loop;

  if p_given then
    for v_order in
      select id from tuckshop_preorders
      where student_id = any(p_student_ids) and for_date = p_for_date and status = 'pending'
      order by id
    loop
      perform fulfill_tuckshop_preorder(v_order.id, auth.uid());
      v_count := v_count + 1;
    end loop;
  else
    for v_order in
      select id, purchase_id from tuckshop_preorders
      where student_id = any(p_student_ids) and for_date = p_for_date and status = 'fulfilled'
      order by id
    loop
      update tuckshop_preorders set status = 'pending', purchase_id = null where id = v_order.id;
      if v_order.purchase_id is not null then
        delete from tuckshop_purchase_items where purchase_id = v_order.purchase_id;
        delete from tuckshop_purchases where id = v_order.purchase_id;
      end if;
      v_count := v_count + 1;
    end loop;
  end if;

  return v_count;
end;
$function$;

comment on function public.set_tuckshop_orders_given(integer[], date, boolean) is
  'Tuckshop hand-out: mark these students'' orders for a day as given (charged, as fulfill_tuckshop_preorder) or undo that (purchase removed, order back to pending). Returns the number of orders changed.';

revoke execute on function public.set_tuckshop_orders_given(integer[], date, boolean) from public, anon;
grant execute on function public.set_tuckshop_orders_given(integer[], date, boolean) to authenticated;

-- The page, after Order Sheets (86).
insert into public.resources (resource_key, label, section, sort_order)
values ('/tuckshop/hand-out', 'Hand Out Orders', 'Tuckshop', 87)
on conflict (resource_key) do update set
  label = excluded.label,
  section = excluded.section,
  sort_order = excluded.sort_order;

-- Same people as the order sheets: the ones who run the shop.
insert into public.role_permissions (role_name, resource_key)
select r, '/tuckshop/hand-out' from unnest(array['admin', 'bursar', 'tuckshop']) as r
on conflict do nothing;
