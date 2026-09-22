-- Migration 119: clear the outstanding tuckshop preorders and close student
-- ordering until Thursday 24 September 2026.
--
-- Asked for on Tue 22 Sep 2026: the orders already placed need clearing and
-- ordering needs to stop until Thursday.
--
-- Why cancel rather than delete: at the time of writing all 24 outstanding
-- preorders were status = 'pending' and *none* had ever been fulfilled
-- (tuckshop_preorders has zero 'fulfilled' rows), so no balance had been
-- deducted and there is nothing to refund. Cancelling instead of deleting
-- keeps the audit trail, and the student sees "cancelled" against the order
-- in their portal rather than it silently disappearing. Scoped by a fixed
-- created_at cutoff so re-running this migration can never sweep up orders
-- placed after it.
--
-- Why a date rather than a boolean: "closed until Thursday" should reopen by
-- itself, with nobody having to remember to flip a switch back. Ordering is
-- blocked while today < tuckshop_ordering_closed_until, so setting it to
-- 2026-09-24 blocks Tue 22nd and Wed 23rd and reopens on Thursday morning.
-- The comparison uses Africa/Lagos, not the database's UTC, so "Thursday"
-- means Thursday at the school rather than 01:00 WAT.
--
-- Follows migration 114's shape: a column on the system_settings singleton,
-- a stable security definer guard function, and the guard checked first
-- inside the SECURITY DEFINER function that does the work — so the caller
-- gets a clear error rather than a half-written order.
--
-- To reopen early:  update system_settings set tuckshop_ordering_closed_until = null;
-- To extend:        update system_settings set tuckshop_ordering_closed_until = 'YYYY-MM-DD';

alter table system_settings
  add column if not exists tuckshop_ordering_closed_until date,
  add column if not exists tuckshop_ordering_closed_note text;

insert into system_settings (id, tuckshop_ordering_closed_until, tuckshop_ordering_closed_note)
values (true, date '2026-09-24', 'Tuckshop ordering closed 22 Sep 2026 per school request; outstanding preorders cleared. Reopens automatically Thursday 24 Sep 2026.')
on conflict (id) do update set
  tuckshop_ordering_closed_until = excluded.tuckshop_ordering_closed_until,
  tuckshop_ordering_closed_note = excluded.tuckshop_ordering_closed_note,
  updated_at = now();

create or replace function tuckshop_ordering_closed()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (now() at time zone 'Africa/Lagos')::date
      < (select tuckshop_ordering_closed_until from system_settings limit 1),
    false
  );
$$;

comment on function tuckshop_ordering_closed() is
  'True while student tuckshop preordering is closed. Driven by system_settings.tuckshop_ordering_closed_until; reopens on its own once that date arrives.';

-- submit_tuckshop_preorder: identical to the version in CURRENT_SCHEMA apart
-- from the closure guard. Tuckshop/bursar staff are deliberately still able
-- to enter an order while ordering is closed — the closure is aimed at
-- students self-serving from the portal, and the shop still needs to be able
-- to handle an exception at the counter.
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

  insert into tuckshop_preorders (student_id, for_date) values (p_student_id, p_for_date)
  returning id into v_preorder_id;

  for v_item in select * from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  loop
    insert into tuckshop_preorder_items (preorder_id, tuckshop_item_id, quantity)
    values (v_preorder_id, v_item.item_id, v_item.quantity);
  end loop;

  return v_preorder_id;
end;
$function$;

-- Clear the orders already placed. Nothing here was fulfilled, so no
-- tuckshop_purchases rows exist for them and no balances change.
update tuckshop_preorders
set status = 'cancelled'
where status = 'pending'
  and created_at < timestamptz '2026-09-22 10:00:00+00';
