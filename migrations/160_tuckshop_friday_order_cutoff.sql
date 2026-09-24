-- Migration 160: lock each week's tuckshop preorders at 11pm on Friday, and
-- add the restaurant order sheets the shop prints from once they're locked.
--
-- Asked for on Thu 24 Sep 2026: students finish ordering at 11.00pm on
-- Friday night; after that the week's orders should be locked, and the
-- tuckshop needs a printout by restaurant — every student in that restaurant
-- with what they ordered, and a total of each item.
--
-- The cutoff is worked out from the order's Saturday rather than stored:
-- orders for Saturday D close at 23:00 Africa/Lagos on D - 1. Nothing has to
-- run at 11pm (no cron job, no flag to flip back on Saturday) — the lock is
-- simply "now() is past the cutoff for that Saturday", so it can't be
-- forgotten and it reopens for the following week by itself.
--
-- After the cutoff students aren't shut out: tuckshop_next_order_date()
-- moves on to the following Saturday, so a student ordering at 11.30pm on
-- Friday is ordering for next week, not slipping into this week's sheet.
-- The portal asks the database for that date instead of working it out from
-- the browser's clock, so a phone set to the wrong time can't aim at a
-- Saturday that's already locked.
--
-- Staff (tuckshop/bursar) are still allowed past the lock, as with the
-- closure in migration 119: the shop has to be able to handle an exception
-- at the counter. The order sheet page is live, so a late staff-entered
-- order still shows up if the sheet is reprinted.
--
-- The two "Students can ... own preorders" INSERT policies are dropped.
-- Every order already goes through submit_tuckshop_preorder(), which is
-- SECURITY DEFINER and owned by postgres, so it never needed them — but
-- while they existed a student could insert into tuckshop_preorder_items
-- straight through the API and add lines to an order that was already
-- locked (or bypass the 119 closure entirely). Removing them makes the RPC
-- the only way in, so its checks are the checks.

create or replace function tuckshop_preorder_cutoff(p_for_date date)
returns timestamptz
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select ((p_for_date - 1) + time '23:00') at time zone 'Africa/Lagos';
$$;

comment on function tuckshop_preorder_cutoff(date) is
  'When student ordering closes for a tuckshop preorder date: 11pm Lagos time the day before (Friday, for a Saturday).';

create or replace function tuckshop_preorder_locked(p_for_date date)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select now() >= tuckshop_preorder_cutoff(p_for_date);
$$;

comment on function tuckshop_preorder_locked(date) is
  'True once the Friday 11pm cutoff for that preorder date has passed.';

-- The Saturday students are currently ordering for: the nearest Saturday
-- after today (Lagos) whose cutoff hasn't passed. On Saturday itself that is
-- next Saturday; from 11pm Friday it skips to the Saturday after tomorrow.
create or replace function tuckshop_next_order_date()
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select d
  from (
    select (now() at time zone 'Africa/Lagos')::date
         + ((6 - extract(isodow from (now() at time zone 'Africa/Lagos')::date)::int + 7) % 7) as sat
  ) x,
  lateral (values (x.sat), (x.sat + 7), (x.sat + 14)) as v(d)
  where d > (now() at time zone 'Africa/Lagos')::date
    and not tuckshop_preorder_locked(d)
  order by d
  limit 1;
$$;

comment on function tuckshop_next_order_date() is
  'The Saturday students can currently preorder for — skips any Saturday whose Friday 11pm cutoff has passed.';

grant execute on function tuckshop_preorder_cutoff(date) to authenticated;
grant execute on function tuckshop_preorder_locked(date) to authenticated;
grant execute on function tuckshop_next_order_date() to authenticated;

-- submit_tuckshop_preorder: as in migration 119, plus the weekly lock. For
-- students the date must also be a Saturday — the portal only ever sends
-- one, and anything else would dodge the Friday cutoff by aiming at a day
-- with a different "day before".
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

drop policy if exists "Students can create own preorders" on tuckshop_preorders;
drop policy if exists "Students can add own preorder items" on tuckshop_preorder_items;

-- The printout page, alongside the other Tuckshop entries (sort_order 80-85).
insert into resources (resource_key, label, section, sort_order)
values ('/tuckshop/order-sheets', 'Order Sheets', 'Tuckshop', 86)
on conflict (resource_key) do update set
  label = excluded.label,
  section = excluded.section,
  sort_order = excluded.sort_order;

-- Same roles as Open / Close Ordering (migration 120): the people who run
-- the shop.
insert into role_permissions (role_name, resource_key)
select r, '/tuckshop/order-sheets' from unnest(array['admin', 'bursar', 'tuckshop']) as r
on conflict do nothing;
