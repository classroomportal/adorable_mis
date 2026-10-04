-- Migration 351: "Not collected" for tuckshop orders.
--
-- Why: the principal, 4 Oct 2026, after asking why tuckshop orders were
-- still pending. Hand Out Orders (/tuckshop/hand-out, migrations 228-233)
-- could only mark an order given; an order the student never came for just
-- stayed 'pending', and once its restaurant's list was saved and locked it
-- stayed pending for good (17 such orders from 26 Sept, 30 Sept and 1 Oct).
-- The principal: "cancel these items and give a button not collected".
--
--   * New order status 'not_collected': the student didn't collect it, so
--     nothing was charged. It is kept apart from 'cancelled', which means
--     the student (or staff) withdrew the order before the tuckshop day,
--     so the record still shows which orders were made and not picked up.
--   * set_tuckshop_orders_not_collected(student_ids, for_date, flag) marks a
--     student's pending orders for the day not collected, or (flag false)
--     puts not-collected orders back to pending. Same people and the same
--     saved-list lock as set_tuckshop_orders_given(): tuckshop and the
--     tuckshop owner, and nothing in a saved list until the owner unlocks.
--     Only pending orders can be marked, so nothing already charged is
--     touched.
--   * save_tuckshop_handout() counts not-collected orders as not given in
--     the saved totals.
--   * The 17 orders left pending in lists that were already saved are
--     marked not collected here. Their lists stay locked; the saved totals
--     already counted them as not given.

set local formwork.change_note = 'Principal (direct)';

alter table public.tuckshop_preorders drop constraint tuckshop_preorders_status_check;
alter table public.tuckshop_preorders add constraint tuckshop_preorders_status_check
  check (status = any (array['pending', 'fulfilled', 'cancelled', 'not_collected']));

create or replace function public.set_tuckshop_orders_not_collected(
  p_student_ids integer[],
  p_for_date date,
  p_not_collected boolean
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student integer;
  v_count integer;
begin
  if not has_staff_role(array['tuckshop', 'tuckshop_owner']) then
    raise exception 'Only tuckshop staff can mark orders as not collected';
  end if;

  -- Same lock and saved-list check as set_tuckshop_orders_given().
  for v_student in select distinct s from unnest(coalesce(p_student_ids, '{}')) as s order by s
  loop
    perform pg_advisory_xact_lock(hashtext('tuckshop_preorder'), v_student);
    if tuckshop_handout_locked(v_student, p_for_date) then
      raise exception 'This list has been saved, so it can''t be changed. Only the tuckshop owner can unlock it.';
    end if;
  end loop;

  if p_not_collected then
    update tuckshop_preorders set status = 'not_collected'
    where student_id = any(p_student_ids) and for_date = p_for_date and status = 'pending';
  else
    update tuckshop_preorders set status = 'pending'
    where student_id = any(p_student_ids) and for_date = p_for_date and status = 'not_collected';
  end if;
  get diagnostics v_count = row_count;

  return v_count;
end;
$function$;

revoke execute on function public.set_tuckshop_orders_not_collected(integer[], date, boolean) from public, anon;
grant execute on function public.set_tuckshop_orders_not_collected(integer[], date, boolean) to authenticated;

comment on function public.set_tuckshop_orders_not_collected(integer[], date, boolean) is
  'Tuckshop hand-out: mark these students'' pending orders for a day as not collected (nothing charged), or put them back to pending. Refused while the list is saved. Returns the number of orders changed.';

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
         count(distinct o.student_id) filter (where o.status in ('pending', 'not_collected')),
         coalesce(sum(tp.total_amount) filter (where o.status = 'fulfilled'), 0)
  into v_given, v_not_given, v_value
  from tuckshop_preorders o
  join students s on s.student_id = o.student_id
  left join tuckshop_purchases tp on tp.id = o.purchase_id
  where o.for_date = p_for_date and coalesce(s.restaurant, '') = p_restaurant
    and o.status in ('pending', 'fulfilled', 'not_collected');

  insert into tuckshop_handout_saves (for_date, restaurant, given_count, not_given_count, given_value, saved_by)
  values (p_for_date, p_restaurant, v_given, v_not_given, v_value, auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

-- The orders left pending in lists that were already saved.
update public.tuckshop_preorders o
set status = 'not_collected'
where o.status = 'pending'
  and o.for_date < '2026-10-03'
  and tuckshop_handout_locked(o.student_id, o.for_date);
