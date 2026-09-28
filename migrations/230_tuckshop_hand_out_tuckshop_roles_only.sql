-- 230_tuckshop_hand_out_tuckshop_roles_only.sql
--
-- Hand Out Orders (/tuckshop/hand-out, migrations 228-229) is for the
-- tuckshop staff and the tuckshop owner only.
--
-- Asked for on Mon 28 Sep 2026: "Only tuckshop and tuckshop owner should
-- have access to that page." Until now admin and bursar had it too, and
-- every admin gets every page anyway (hasAccess() in lib/AuthContext.js).
--
--   * role_permissions for the page: tuckshop and tuckshop_owner only.
--   * The page and its dashboard link check staff roles directly
--     (lib/tuckshopHandout.js), so being an admin doesn't let anyone in.
--   * The database agrees: marking orders given, saving a list and reading
--     the saves now use has_staff_role(), which, unlike
--     user_has_staff_role(), admins don't pass just for being admins. So
--     the page's actions can't be called from outside it either.
--   * fulfill_tuckshop_preorder() and record_tuckshop_purchase() also
--     accept tuckshop_owner. Marking an order given goes through them, and
--     without this an owner who isn't also an admin would be refused
--     halfway. Their other callers (Fulfil on /tuckshop/preorders, Sell
--     Items) keep tuckshop, bursar and admins as before.
--   * Unlocking stays tuckshop_owner only (migration 229).

set local formwork.change_note = 'Principal (direct)';

delete from public.role_permissions
where resource_key = '/tuckshop/hand-out' and role_name not in ('tuckshop', 'tuckshop_owner');

insert into public.role_permissions (role_name, resource_key)
select r, '/tuckshop/hand-out' from unnest(array['tuckshop', 'tuckshop_owner']) as r
on conflict do nothing;

drop policy if exists "Tuckshop staff read hand-out saves" on public.tuckshop_handout_saves;
create policy "Tuckshop staff read hand-out saves" on public.tuckshop_handout_saves
  for select using (has_staff_role(array['tuckshop', 'tuckshop_owner']));

create or replace function public.save_tuckshop_handout(p_for_date date, p_restaurant text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id bigint;
  v_given integer;
  v_not_given integer;
  v_value numeric;
begin
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can save hand-out lists';
  end if;

  p_restaurant := coalesce(p_restaurant, '');

  if exists (select 1 from tuckshop_handout_saves
             where for_date = p_for_date and restaurant = p_restaurant and unlocked_at is null) then
    raise exception 'This list has already been saved. Only the tuckshop owner can unlock it.';
  end if;

  select count(distinct o.student_id) filter (where o.status = 'fulfilled'),
         count(distinct o.student_id) filter (where o.status = 'pending'),
         coalesce(sum(tp.total_amount) filter (where o.status = 'fulfilled'), 0)
  into v_given, v_not_given, v_value
  from tuckshop_preorders o
  join students s on s.student_id = o.student_id
  left join tuckshop_purchases tp on tp.id = o.purchase_id
  where o.for_date = p_for_date and coalesce(s.restaurant, '') = p_restaurant
    and o.status in ('pending', 'fulfilled');

  insert into tuckshop_handout_saves (for_date, restaurant, given_count, not_given_count, given_value, saved_by)
  values (p_for_date, p_restaurant, v_given, v_not_given, v_value, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

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
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can mark orders as given';
  end if;

  -- Same lock as save_tuckshop_order(), so an order can't be changed while
  -- it's being charged.
  for v_student in select distinct s from unnest(coalesce(p_student_ids, '{}')) as s order by s
  loop
    perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), v_student);
    if tuckshop_handout_locked(v_student, p_for_date) then
      raise exception 'This list has been saved, so it can''t be changed. Only the tuckshop owner can unlock it.';
    end if;
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

-- As in 229, plus tuckshop_owner.
create or replace function public.fulfill_tuckshop_preorder(p_preorder_id bigint, p_created_by uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_for_date date;
  v_items jsonb;
  v_purchase_id bigint;
begin
  if not user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can fulfil preorders';
  end if;

  select student_id, for_date into v_student_id, v_for_date
  from tuckshop_preorders where id = p_preorder_id and status = 'pending';
  if not found then
    raise exception 'Preorder not found or already handled';
  end if;

  if tuckshop_handout_locked(v_student_id, v_for_date) then
    raise exception 'This student''s restaurant list for that day has been saved. Only the tuckshop owner can unlock it.';
  end if;

  select jsonb_agg(jsonb_build_object('item_id', tuckshop_item_id, 'quantity', quantity))
  into v_items
  from tuckshop_preorder_items where preorder_id = p_preorder_id;

  v_purchase_id := record_tuckshop_purchase(v_student_id, v_items, p_created_by);

  update tuckshop_preorders set status = 'fulfilled', purchase_id = v_purchase_id where id = p_preorder_id;

  return v_purchase_id;
end;
$function$;

-- As live, plus tuckshop_owner.
create or replace function public.record_tuckshop_purchase(p_student_id integer, p_items jsonb, p_created_by uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_purchase_id bigint;
  v_total numeric := 0;
  v_item record;
  v_price numeric;
  v_line_total numeric;
begin
  if not user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can record purchases';
  end if;

  insert into tuckshop_purchases (student_id, total_amount, created_by)
  values (p_student_id, 0, p_created_by)
  returning id into v_purchase_id;

  for v_item in select * from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  loop
    select price into v_price from tuckshop_items where id = v_item.item_id;
    v_line_total := v_price * v_item.quantity;
    v_total := v_total + v_line_total;

    insert into tuckshop_purchase_items (purchase_id, tuckshop_item_id, quantity, unit_price, line_total)
    values (v_purchase_id, v_item.item_id, v_item.quantity, v_price, v_line_total);
  end loop;

  update tuckshop_purchases set total_amount = v_total where id = v_purchase_id;

  return v_purchase_id;
end;
$function$;
