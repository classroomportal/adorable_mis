-- Migration 171: a student can order at most two of any one tuckshop item
-- for a Saturday, and the orders already placed are cut back to fit.
--
-- Asked for on Thu 24 Sep 2026, shortly after ordering reopened at 20:51.
-- Within half an hour one order asked for 800 packs of Chin Chin, another
-- for 4 Gala, and one student had bought Pepsi one at a time across three
-- separate orders.
--
-- The limit is per student, per item, per Saturday — summed across every
-- order the student has for that date, not just within one basket, or
-- placing several small orders (as above) would get round it. Cancelled
-- orders don't count. It applies whoever submits the order: unlike the
-- closure and the Friday cutoff, this is a rule about the order itself, not
-- about when students may order, so there's no staff exemption.
--
-- submit_tuckshop_preorder() takes a per-student advisory lock for the
-- check, so two orders submitted at the same moment can't both see "one
-- left" and both succeed. It also merges any repeated item_id in the
-- payload and rejects zero/negative quantities, which it previously stored
-- as-is.
--
-- A check constraint (1-2 per line) backs this up at table level. It can't
-- see across orders — the function does that — but it stops a single line
-- ever holding 800 again, whatever writes it.
--
-- Correcting existing orders: for each student/Saturday/item, lines are
-- taken in the order they were placed and the first two units kept; the
-- rest are trimmed (a line keeps what fits) or deleted (a line with nothing
-- left). An order left with no lines at all is deleted rather than kept as
-- an empty "pending" order. Only pending, unfulfilled orders are touched. At
-- the time of writing that meant: line 136 800 -> 2, line 143 4 -> 2, and
-- the third single-Pepsi line (order 88, placed last of 86-88) removed,
-- leaving order 88 empty, so it was deleted.

-- 1. Trim existing orders.
with ranked as (
  select i.id,
         i.quantity,
         coalesce(sum(i.quantity) over (
           partition by p.student_id, p.for_date, i.tuckshop_item_id
           order by p.created_at, p.id, i.id
           rows between unbounded preceding and 1 preceding
         ), 0) as before_qty
  from tuckshop_preorder_items i
  join tuckshop_preorders p on p.id = i.preorder_id
  where p.status = 'pending' and p.purchase_id is null
),
allowed as (
  select id, quantity, greatest(0, least(quantity, 2 - before_qty)) as keep
  from ranked
),
trimmed as (
  update tuckshop_preorder_items t
  set quantity = a.keep
  from allowed a
  where t.id = a.id and a.keep > 0 and a.keep < a.quantity
  returning t.id
)
delete from tuckshop_preorder_items t
using allowed a
where t.id = a.id and a.keep = 0;

delete from tuckshop_preorders p
where p.status = 'pending'
  and p.purchase_id is null
  and not exists (select 1 from tuckshop_preorder_items i where i.preorder_id = p.id);

-- 2. Table-level backstop.
alter table tuckshop_preorder_items
  add constraint tuckshop_preorder_items_quantity_1_to_2
  check (quantity between 1 and 2);

-- 3. Enforce in the only way orders come in. As migration 160, plus the
--    quantity rules.
create or replace function public.submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_preorder_id bigint;
  v_item record;
  v_is_staff boolean;
begin
  v_is_staff := user_has_staff_role(array['tuckshop', 'bursar']);

  if not (
    v_is_staff
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
  ) then
    raise exception 'Not authorized to preorder for this student';
  end if;

  if not v_is_staff and tuckshop_ordering_closed() then
    raise exception 'Tuckshop ordering is closed at the moment — it reopens on %.',
      to_char((select tuckshop_ordering_closed_until from system_settings limit 1), 'FMDay FMDD FMMonth');
  end if;

  if not v_is_staff then
    if extract(isodow from p_for_date) <> 6 then
      raise exception 'Tuckshop preorders are for Saturdays only';
    end if;
    if tuckshop_preorder_locked(p_for_date) then
      raise exception 'Orders for Saturday % closed at 11pm on Friday. You can order for Saturday % instead.',
        to_char(p_for_date, 'FMDD FMMonth'),
        to_char(tuckshop_next_order_date(), 'FMDD FMMonth');
    end if;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    where x.quantity is null or x.quantity < 1
  ) then
    raise exception 'Each item needs a quantity of at least 1';
  end if;

  -- Serialise orders for this student so the limit can't be raced.
  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);

  select t.name as item_name, n.qty + coalesce(prev.qty, 0) as total
  into v_item
  from (
    select x.item_id, sum(x.quantity) as qty
    from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    group by x.item_id
  ) n
  join tuckshop_items t on t.id = n.item_id
  left join lateral (
    select sum(i.quantity) as qty
    from tuckshop_preorders p
    join tuckshop_preorder_items i on i.preorder_id = p.id
    where p.student_id = p_student_id
      and p.for_date = p_for_date
      and p.status <> 'cancelled'
      and i.tuckshop_item_id = n.item_id
  ) prev on true
  where n.qty + coalesce(prev.qty, 0) > 2
  limit 1;

  if found then
    raise exception 'You can order at most 2 of each item for a Saturday — that would make % %.',
      v_item.total, v_item.item_name;
  end if;

  insert into tuckshop_preorders (student_id, for_date) values (p_student_id, p_for_date)
  returning id into v_preorder_id;

  for v_item in
    select x.item_id, sum(x.quantity)::integer as quantity
    from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    group by x.item_id
  loop
    insert into tuckshop_preorder_items (preorder_id, tuckshop_item_id, quantity)
    values (v_preorder_id, v_item.item_id, v_item.quantity);
  end loop;

  return v_preorder_id;
end;
$function$;
