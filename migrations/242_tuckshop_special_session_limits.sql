-- 242_tuckshop_special_session_limits.sql
--
-- Each special tuckshop session (migration 241) sets its own order limits.
--
-- Asked for on Mon 28 Sep 2026, for the "Nigerian Independence" session
-- (drinks and Nigeria polos, orders for Thu 1 Oct): "Special sessions need
-- to be able one drink and one other item". The normal tuckshop-day limits
-- (2 of each item, 2 snacks and drinks in total, any number of other
-- items) would have let a student order two drinks, or two polos.
--
-- tuckshop_special_sessions gets three limits, all per student for the
-- session's delivery date:
--   * max_per_item: most of any one item (default 2, as normal days);
--   * max_food: most snacks and drinks (tuckshop_items.is_food) in total
--     (default 2, as normal days);
--   * max_other: most of everything else in total (null = no limit, as
--     normal days).
-- save_tuckshop_order() uses them on a special session's date and the
-- usual 2/2/none otherwise. They apply to staff entering orders too, as
-- the normal limits always have. Edited on /tuckshop/ordering.
--
-- The Nigerian Independence session is set to 1 drink and 1 other item.

set local formwork.change_note = 'Principal (direct)';

alter table public.tuckshop_special_sessions
  add column if not exists max_per_item smallint not null default 2 check (max_per_item >= 1),
  add column if not exists max_food smallint not null default 2 check (max_food >= 0),
  add column if not exists max_other smallint check (max_other >= 0);

comment on column public.tuckshop_special_sessions.max_per_item is 'Most of any one item a student can order for this session (migration 242).';
comment on column public.tuckshop_special_sessions.max_food is 'Most snacks and drinks (tuckshop_items.is_food) in total per student for this session (migration 242).';
comment on column public.tuckshop_special_sessions.max_other is 'Most non-food items in total per student for this session; null = no limit (migration 242).';

update public.tuckshop_special_sessions
set max_food = 1, max_other = 1
where name = 'Nigerian Independence' and for_date = date '2026-10-01';

create or replace function public.save_tuckshop_order(p_student_id integer, p_for_date date, p_items jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_is_staff boolean;
  v_keep bigint;
  v_bad record;
  v_food integer;
  v_win record;
  v_special bigint;
  v_per_item integer := 2;
  v_max_food integer := 2;
  v_max_other integer;
  v_other integer;
begin
  v_is_staff := user_has_staff_role(array['tuckshop', 'bursar']);

  if not (
    v_is_staff
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
  ) then
    raise exception 'Not authorized to order for this student';
  end if;

  select id, max_per_item, max_food, max_other
  into v_special, v_per_item, v_max_food, v_max_other
  from tuckshop_special_sessions where for_date = p_for_date;
  if v_special is null then
    v_per_item := 2;
    v_max_food := 2;
    v_max_other := null;
  end if;

  if not v_is_staff then
    if v_special is null and tuckshop_ordering_closed() then
      raise exception 'Tuckshop ordering is closed at the moment — it reopens on %.',
        to_char((select tuckshop_ordering_closed_until from system_settings limit 1), 'FMDay FMDD FMMonth');
    end if;
    select * into v_win from tuckshop_order_window(p_for_date);
    if not found then
      raise exception 'There is no tuckshop on %.', to_char(p_for_date, 'FMDay FMDD FMMonth');
    end if;
    if now() < v_win.opens_at then
      raise exception 'Ordering for % opens at %.',
        to_char(p_for_date, 'FMDay FMDD FMMonth'),
        to_char(v_win.opens_at at time zone 'Africa/Lagos', 'FMHH12:MIam "on" FMDay FMDD FMMonth');
    end if;
    if now() >= v_win.closes_at then
      raise exception 'Orders for % closed at %, so they can no longer be placed, changed or cancelled.',
        to_char(p_for_date, 'FMDay FMDD FMMonth'),
        to_char(v_win.closes_at at time zone 'Africa/Lagos', 'FMHH12:MIam "on" FMDay FMDD FMMonth');
    end if;
  end if;

  p_items := coalesce(p_items, '[]'::jsonb);

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    where x.item_id is null or x.quantity is null or x.quantity < 1
  ) then
    raise exception 'Each item needs a quantity of at least 1';
  end if;

  -- On a special session's date only its items are on sale (active or not);
  -- otherwise any active item. Staff at the counter can enter anything.
  select x.item_id into v_bad
  from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  left join tuckshop_items t on t.id = x.item_id
  where t.id is null
     or (not v_is_staff and v_special is null and not t.active)
     or (not v_is_staff and v_special is not null and not exists (
           select 1 from tuckshop_special_session_items si
           where si.session_id = v_special and si.tuckshop_item_id = x.item_id))
  limit 1;
  if found then
    raise exception 'One of the items in this order is not on sale for this tuckshop day — remove it and try again';
  end if;

  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);

  with basket as (
    select x.item_id, x.quantity
    from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    union all
    select i.tuckshop_item_id, i.quantity
    from tuckshop_preorders p
    join tuckshop_preorder_items i on i.preorder_id = p.id
    where p.student_id = p_student_id
      and p.for_date = p_for_date
      and p.status not in ('pending', 'cancelled')
  )
  select t.name, sum(b.quantity) as total into v_bad
  from basket b join tuckshop_items t on t.id = b.item_id
  group by t.name, b.item_id
  having sum(b.quantity) > v_per_item
  limit 1;
  if found then
    raise exception 'You can order at most % of each item for one tuckshop day — that would make % %.',
      v_per_item, v_bad.total, v_bad.name;
  end if;

  with basket as (
    select x.item_id, x.quantity
    from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    union all
    select i.tuckshop_item_id, i.quantity
    from tuckshop_preorders p
    join tuckshop_preorder_items i on i.preorder_id = p.id
    where p.student_id = p_student_id
      and p.for_date = p_for_date
      and p.status not in ('pending', 'cancelled')
  )
  select coalesce(sum(b.quantity) filter (where t.is_food), 0),
         coalesce(sum(b.quantity) filter (where not t.is_food), 0)
  into v_food, v_other
  from basket b join tuckshop_items t on t.id = b.item_id;
  if v_food > v_max_food then
    raise exception 'You can order at most % snack%/drink% in total for one tuckshop day — that would make %.',
      v_max_food, case when v_max_food = 1 then '' else 's' end, case when v_max_food = 1 then '' else 's' end, v_food;
  end if;
  if v_max_other is not null and v_other > v_max_other then
    raise exception 'You can order at most % other item% (not snacks or drinks) for this tuckshop day — that would make %.',
      v_max_other, case when v_max_other = 1 then '' else 's' end, v_other;
  end if;

  if jsonb_array_length(p_items) = 0 then
    update tuckshop_preorders
    set status = 'cancelled'
    where student_id = p_student_id
      and for_date = p_for_date
      and status = 'pending';
    return null;
  end if;

  select id into v_keep
  from tuckshop_preorders
  where student_id = p_student_id and for_date = p_for_date and status = 'pending'
  order by created_at, id
  limit 1;

  delete from tuckshop_preorder_items
  where preorder_id in (
    select id from tuckshop_preorders
    where student_id = p_student_id and for_date = p_for_date and status = 'pending'
  );

  if v_keep is null then
    insert into tuckshop_preorders (student_id, for_date) values (p_student_id, p_for_date)
    returning id into v_keep;
  else
    delete from tuckshop_preorders
    where student_id = p_student_id and for_date = p_for_date and status = 'pending'
      and id <> v_keep;
  end if;

  insert into tuckshop_preorder_items (preorder_id, tuckshop_item_id, quantity)
  select v_keep, x.item_id, sum(x.quantity)::integer
  from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  group by x.item_id;

  return v_keep;
end;
$function$;

comment on function public.save_tuckshop_order(integer, date, jsonb) is
  'Replace a student''s tuckshop order for a tuckshop day with the given basket ([] cancels it). Enforces the manual closure (not on a special session''s date), the ordering window, the items on sale (a special session''s list, else active items) and the limits: a special session''s own max_per_item/max_food/max_other (migration 242), otherwise 2 of each item and 2 snacks/drinks in total.';
