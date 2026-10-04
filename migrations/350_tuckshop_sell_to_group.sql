-- Migration 350: sell one tuckshop item to a group of students at once.
--
-- Why: the principal, 4 Oct 2026: the tuck shop lady needs to charge the
-- same item to a group of students (a form, a year, a restaurant, a student
-- group), but "she needs to tick off once she has loaded the group on her
-- screen". Until now Sell Items (/tuckshop/purchase) took one student at a
-- time, and the only group action, Top Up Balance, tops each student up to
-- a target, so every student is charged a different amount.
--
-- The page loads the group and she ticks the students who are actually
-- getting the item; only the ticked students are sent here. This records
-- one ordinary purchase per student through record_tuckshop_purchase(),
-- the same function Sell Items uses, so balances, Balances and the
-- purchase history treat a group sale exactly like a counter sale.
--
--   * Same people as Sell Items: tuckshop, bursar, tuckshop_owner (and
--     admins, through user_has_staff_role()).
--   * The price comes from tuckshop_items, never from the request, and the
--     item must be active.
--   * Every student must be active; one that isn't stops the whole sale,
--     so nothing is half-charged. The same goes for any other error: it is
--     all or nothing.
--   * Who sold it is auth.uid(), not a value from the page.
--   * No balance check, like Sell Items: a balance can go negative.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.sell_tuckshop_item_to_students(
  p_item_id bigint,
  p_quantity integer,
  p_student_ids integer[]
)
returns table(student_id integer, purchase_id bigint, amount numeric)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_price numeric;
  v_ids integer[];
  v_bad integer;
  v_sid integer;
  v_pid bigint;
begin
  if not user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can record purchases';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 50 then
    raise exception 'Quantity must be between 1 and 50.';
  end if;

  select ti.price into v_price
  from tuckshop_items ti
  where ti.id = p_item_id and ti.active;
  if v_price is null then
    raise exception 'That item is not on sale.';
  end if;

  v_ids := array(select distinct x from unnest(coalesce(p_student_ids, '{}')) x where x is not null);
  if cardinality(v_ids) = 0 then
    raise exception 'Tick at least one student.';
  end if;
  if cardinality(v_ids) > 1000 then
    raise exception 'Too many students in one sale.';
  end if;

  select count(*) into v_bad
  from unnest(v_ids) x
  where not exists (select 1 from students s where s.student_id = x and s.status = 'active');
  if v_bad > 0 then
    raise exception '% of the ticked students are not current students. Nothing was charged.', v_bad;
  end if;

  foreach v_sid in array v_ids loop
    v_pid := record_tuckshop_purchase(
      v_sid,
      jsonb_build_array(jsonb_build_object('item_id', p_item_id, 'quantity', p_quantity)),
      auth.uid()
    );
    student_id := v_sid;
    purchase_id := v_pid;
    amount := v_price * p_quantity;
    return next;
  end loop;
end;
$function$;

revoke execute on function public.sell_tuckshop_item_to_students(bigint, integer, integer[]) from public, anon;
grant execute on function public.sell_tuckshop_item_to_students(bigint, integer, integer[]) to authenticated;
