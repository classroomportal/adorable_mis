-- Migration 180: a student can order at most two food/drink items in total
-- for a Saturday, and the orders already placed are cut back to fit.
--
-- Asked for on Fri 25 Sep 2026 (22:30 Lagos, half an hour before that
-- week's orders locked): "all Saturday orders must be limited to 2 food
-- type articles". Confirmed with the school that:
--   * "food" means anything edible — snacks AND drinks;
--   * the limit is 2 units in total (1 Gala + 1 Pepsi, or 2 Gala — not
--     2 Gala + 1 Pepsi), summed across every order the student has for
--     that Saturday, cancelled orders excepted.
-- Toiletries and stationery aren't food and aren't limited by this rule.
-- Migration 171's "at most 2 of any one item" still applies to everything.
--
-- Which items are food: nothing recorded it, so this adds
-- tuckshop_items.is_food (default false, so a new item is non-food until
-- someone ticks it on Items & Prices) and sets it for every edible item,
-- inactive ones included so the flag is right if they're switched back on.
-- The ids are listed explicitly rather than matched by name.
--
-- Correcting existing orders: when written, 70 of the 210 students with
-- food in their order were over, 568 food units in total. For each student
-- and Saturday, food lines are taken in the order they were placed and the
-- first two units kept; the rest are trimmed (7 lines) or deleted (141
-- lines), leaving 408. Non-food lines are untouched. An order left with no
-- lines is deleted. Only pending, unfulfilled orders are touched.
--
-- Because that's a large cut made at short notice, every line's original
-- state is copied to tuckshop_preorder_trim_backup_180 first, so it can be
-- put back by hand if the school changes its mind. That table has RLS on
-- and deliberately no grants or policies: it's for the SQL editor only,
-- never the app.

-- 1. Which items are food.
alter table tuckshop_items add column if not exists is_food boolean not null default false;

comment on column tuckshop_items.is_food is
  'Edible (snacks and drinks). A student can preorder at most 2 food units in total per Saturday.';

update tuckshop_items
set is_food = true
where id in (
  -- active: drinks
  26, 9, 21, 22, 24, 28, 27, 25, 32,
  -- active: snacks
  4, 31, 20, 18, 19, 17, 30, 29,
  -- inactive, all edible
  7, 15, 5, 34, 6, 14, 23, 11, 1, 13, 12, 3, 2, 10, 33, 16, 8
);

-- 2. Back up, then trim.
create table tuckshop_preorder_trim_backup_180 as
select i.id as line_id, i.preorder_id, i.tuckshop_item_id, i.quantity as original_quantity,
       p.student_id, p.for_date, p.created_at as order_created_at, now() as backed_up_at
from tuckshop_preorder_items i
join tuckshop_preorders p on p.id = i.preorder_id
join tuckshop_items t on t.id = i.tuckshop_item_id
where p.status = 'pending' and p.purchase_id is null and t.is_food;

alter table tuckshop_preorder_trim_backup_180 enable row level security;

comment on table tuckshop_preorder_trim_backup_180 is
  'Food preorder lines as they were before migration 180 trimmed them to 2 food units per student per Saturday. SQL-editor only.';

with ranked as (
  select i.id,
         i.quantity,
         coalesce(sum(i.quantity) over (
           partition by p.student_id, p.for_date
           order by p.created_at, p.id, i.id
           rows between unbounded preceding and 1 preceding
         ), 0) as before_qty
  from tuckshop_preorder_items i
  join tuckshop_preorders p on p.id = i.preorder_id
  join tuckshop_items t on t.id = i.tuckshop_item_id
  where p.status = 'pending' and p.purchase_id is null and t.is_food
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

-- 3. Enforce. As migration 171, plus the food total.
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
  v_food_total integer;
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

  -- Serialise orders for this student so the limits can't be raced.
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

  select coalesce((
           select sum(x.quantity)
           from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
           join tuckshop_items t on t.id = x.item_id
           where t.is_food
         ), 0)
       + coalesce((
           select sum(i.quantity)
           from tuckshop_preorders p
           join tuckshop_preorder_items i on i.preorder_id = p.id
           join tuckshop_items t on t.id = i.tuckshop_item_id
           where p.student_id = p_student_id
             and p.for_date = p_for_date
             and p.status <> 'cancelled'
             and t.is_food
         ), 0)
  into v_food_total;

  if v_food_total > 2 then
    raise exception 'You can order at most 2 snacks and drinks in total for a Saturday — that would make %.',
      v_food_total;
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
