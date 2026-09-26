-- Migration 186: students can view, change and cancel their tuckshop order
-- while ordering is open, and Saturday orders now close at 11pm on
-- THURSDAY rather than Friday.
--
-- Asked for on Sat 26 Sep 2026:
--   * "While the tuckshop ordering is open, students need to be able to
--     view, edit and cancel order." Until now a student could only add
--     another order — nothing let them change or withdraw one, so a
--     mistake meant a second order on top (14 students had several orders
--     for 26 Sep).
--   * "Close Saturday tuckshop automatically at 11pm on Thursday night with
--     a warning to students." The warning is in the portal (migration-free:
--     a banner in the last 24 hours before the cutoff).
--
-- Cutoff: tuckshop_preorder_cutoff() is the single place the rule lives —
-- tuckshop_preorder_locked() and tuckshop_next_order_date() both go through
-- it, so moving it from (Saturday - 1) to (Saturday - 2) moves the lock, the
-- "you're now ordering for next week" rollover and the error messages
-- together. Nothing runs at 11pm; the lock is still "now() is past the
-- cutoff for that Saturday". Orders already placed for Sat 26 Sep were
-- locked under both rules, so none of them change state.
--
-- One order per Saturday: save_tuckshop_order() takes the student's whole
-- basket for a Saturday and makes it so — it rewrites the lines of their
-- pending order (creating one if there isn't one), folds any extra pending
-- orders for the same Saturday into it, and an empty basket cancels the
-- order (status 'cancelled', so the student still sees it in their
-- history). Limits are checked against the new basket plus anything already
-- fulfilled for that Saturday, not against the order being replaced — so
-- changing 2 Gala to 2 Pepsi works, where "add another order" would have
-- counted all four.
--
-- Students can only save or cancel while ordering is open (not manually
-- closed, not past the Thursday cutoff), and only with items that are still
-- on sale. Tuckshop/bursar staff are exempt from the timing and on-sale
-- checks, as with the rest of preordering, but not from the limits.
--
-- submit_tuckshop_preorder() is kept for any browser still running the old
-- portal page: it now adds the submitted items to the student's existing
-- basket and hands the result to save_tuckshop_order(), so it also ends up
-- with one order per Saturday and every check in one place.

create or replace function tuckshop_preorder_cutoff(p_for_date date)
returns timestamptz
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select ((p_for_date - 2) + time '23:00') at time zone 'Africa/Lagos';
$$;

comment on function tuckshop_preorder_cutoff(date) is
  'When student ordering closes for a tuckshop preorder date: 11pm Lagos time two days before (Thursday, for a Saturday).';

comment on function tuckshop_preorder_locked(date) is
  'True once the Thursday 11pm cutoff for that preorder date has passed.';

comment on function tuckshop_next_order_date() is
  'The Saturday students can currently preorder for — skips any Saturday whose Thursday 11pm cutoff has passed.';

create or replace function save_tuckshop_order(p_student_id integer, p_for_date date, p_items jsonb)
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
begin
  v_is_staff := user_has_staff_role(array['tuckshop', 'bursar']);

  if not (
    v_is_staff
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
  ) then
    raise exception 'Not authorized to order for this student';
  end if;

  if not v_is_staff then
    if tuckshop_ordering_closed() then
      raise exception 'Tuckshop ordering is closed at the moment — it reopens on %.',
        to_char((select tuckshop_ordering_closed_until from system_settings limit 1), 'FMDay FMDD FMMonth');
    end if;
    if extract(isodow from p_for_date) <> 6 then
      raise exception 'Tuckshop orders are for Saturdays only';
    end if;
    if tuckshop_preorder_locked(p_for_date) then
      raise exception 'Orders for Saturday % closed at 11pm on Thursday, so they can no longer be placed, changed or cancelled.',
        to_char(p_for_date, 'FMDD FMMonth');
    end if;
  end if;

  p_items := coalesce(p_items, '[]'::jsonb);

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
    where x.item_id is null or x.quantity is null or x.quantity < 1
  ) then
    raise exception 'Each item needs a quantity of at least 1';
  end if;

  select x.item_id into v_bad
  from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  left join tuckshop_items t on t.id = x.item_id
  where t.id is null or (not t.active and not v_is_staff)
  limit 1;
  if found then
    raise exception 'One of the items in this order is no longer sold — remove it and try again';
  end if;

  -- Serialise changes to this student's orders so the limits can't be raced.
  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);

  -- The basket being saved, plus anything already fulfilled for that
  -- Saturday. The pending order is being replaced, so it doesn't count.
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
  having sum(b.quantity) > 2
  limit 1;
  if found then
    raise exception 'You can order at most 2 of each item for a Saturday — that would make % %.',
      v_bad.total, v_bad.name;
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
  select coalesce(sum(b.quantity), 0) into v_food
  from basket b join tuckshop_items t on t.id = b.item_id
  where t.is_food;
  if v_food > 2 then
    raise exception 'You can order at most 2 snacks and drinks in total for a Saturday — that would make %.',
      v_food;
  end if;

  -- Empty basket: cancel.
  if jsonb_array_length(p_items) = 0 then
    update tuckshop_preorders
    set status = 'cancelled'
    where student_id = p_student_id
      and for_date = p_for_date
      and status = 'pending';
    return null;
  end if;

  -- Keep the earliest pending order, fold any others into it.
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

comment on function save_tuckshop_order(integer, date, jsonb) is
  'Replace a student''s tuckshop order for a Saturday with the given basket ([] cancels it). Enforces the closure, the Thursday 11pm cutoff, 2 of each item and 2 snacks/drinks in total.';

grant execute on function save_tuckshop_order(integer, date, jsonb) to authenticated;

-- Old portal pages: add to the existing basket, then save it.
create or replace function public.submit_tuckshop_preorder(p_student_id integer, p_for_date date, p_items jsonb)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_merged jsonb;
begin
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(item_id bigint, quantity integer)
    where x.item_id is null or x.quantity is null or x.quantity < 1
  ) then
    raise exception 'Each item needs a quantity of at least 1';
  end if;

  perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), p_student_id);

  select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'quantity', qty)), '[]'::jsonb)
  into v_merged
  from (
    select item_id, sum(quantity)::integer as qty
    from (
      select x.item_id, x.quantity
      from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(item_id bigint, quantity integer)
      union all
      select i.tuckshop_item_id, i.quantity
      from tuckshop_preorders p
      join tuckshop_preorder_items i on i.preorder_id = p.id
      where p.student_id = p_student_id and p.for_date = p_for_date and p.status = 'pending'
    ) u
    group by item_id
  ) m;

  return save_tuckshop_order(p_student_id, p_for_date, v_merged);
end;
$function$;
