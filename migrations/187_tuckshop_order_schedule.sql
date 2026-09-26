-- Migration 187: tuckshop ordering runs to an editable weekly schedule, with
-- two tuckshop days — Wednesday and Saturday — each with its own ordering
-- window.
--
-- Asked for on Sat 26 Sep 2026, straight after migration 186 moved the
-- Saturday cutoff to Thursday 11pm:
--   "the rota should be by default 11pm on Thursday close for Saturday,
--    Monday 5pm open for Wednesday, Tuesday 9am close for Wednesday,
--    Wednesday 7pm open for Saturday. This schedule could be edited by
--    user on a page."
--
-- So the default rota is:
--   Wednesday tuckshop — ordering opens Monday 5pm, closes Tuesday 9am
--   Saturday  tuckshop — ordering opens Wednesday 7pm, closes Thursday 11pm
-- and outside those windows students can't place, change or cancel orders.
--
-- tuckshop_order_schedule holds one row per tuckshop day, with the opening
-- and closing moments as a weekday + time before it. Weekdays are ISO
-- (1 = Monday … 7 = Sunday). A weekday equal to the tuckshop day itself
-- means that same day, never the week before. The check constraint makes
-- the window open before it closes. Staff edit it on /tuckshop/ordering.
--
-- Everything else goes through tuckshop_order_window(date), so changing a
-- row moves the lock, the opening, what the portal offers and the error
-- messages together. Nothing is scheduled to run at those times — "open" is
-- simply "now() is inside that date's window", worked out in Lagos time.
--
--   * tuckshop_preorder_cutoff/locked keep their names and meaning (they're
--     used by the order sheets and older code) but now come from the
--     schedule; a date that isn't a tuckshop day counts as locked.
--   * tuckshop_order_windows() lists the upcoming windows (open now or
--     still to come) for the portal and the staff page.
--   * tuckshop_next_order_date() returns the date whose window is open now,
--     or failing that the next one to open.
--   * save_tuckshop_order() replaces its Saturday-only and cutoff checks
--     with "is this date's window open right now", and the limits apply per
--     tuckshop day rather than per Saturday.
--
-- The manual closure (system_settings.tuckshop_ordering_closed_until,
-- migrations 119/120) still works on top of the schedule, for holidays and
-- stock-takes.

create table if not exists tuckshop_order_schedule (
  service_dow smallint primary key check (service_dow between 1 and 7),
  opens_dow smallint not null check (opens_dow between 1 and 7),
  opens_time time not null,
  closes_dow smallint not null check (closes_dow between 1 and 7),
  closes_time time not null,
  updated_at timestamptz not null default now(),
  constraint tuckshop_order_schedule_opens_before_closes check (
    ((service_dow - opens_dow + 7) % 7) * 1440
      - (extract(hour from opens_time) * 60 + extract(minute from opens_time))
    >
    ((service_dow - closes_dow + 7) % 7) * 1440
      - (extract(hour from closes_time) * 60 + extract(minute from closes_time))
  )
);

comment on table tuckshop_order_schedule is
  'Weekly tuckshop ordering rota: one row per tuckshop day (ISO weekday), with the weekday+time ordering opens and closes before it. Edited on /tuckshop/ordering.';

alter table tuckshop_order_schedule enable row level security;
grant select, insert, update, delete on public.tuckshop_order_schedule to authenticated;

create policy "Tuckshop schedule readable by all authenticated"
  on tuckshop_order_schedule for select to authenticated
  using (true);

create policy "Tuckshop schedule writable by tuckshop staff"
  on tuckshop_order_schedule for all to authenticated
  using (is_admin() or user_has_staff_role(array['tuckshop', 'bursar']))
  with check (is_admin() or user_has_staff_role(array['tuckshop', 'bursar']));

insert into tuckshop_order_schedule (service_dow, opens_dow, opens_time, closes_dow, closes_time)
values
  (3, 1, time '17:00', 2, time '09:00'),   -- Wednesday: Mon 5pm -> Tue 9am
  (6, 3, time '19:00', 4, time '23:00')    -- Saturday:  Wed 7pm -> Thu 11pm
on conflict (service_dow) do nothing;

-- The ordering window for one date, or no row if it isn't a tuckshop day.
create or replace function tuckshop_order_window(p_for_date date)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select ((p_for_date - ((s.service_dow - s.opens_dow + 7) % 7)) + s.opens_time) at time zone 'Africa/Lagos',
         ((p_for_date - ((s.service_dow - s.closes_dow + 7) % 7)) + s.closes_time) at time zone 'Africa/Lagos'
  from tuckshop_order_schedule s
  where s.service_dow = extract(isodow from p_for_date);
$$;

comment on function tuckshop_order_window(date) is
  'When student ordering opens and closes for a tuckshop date, from tuckshop_order_schedule. No row if the date is not a tuckshop day.';

create or replace function tuckshop_preorder_cutoff(p_for_date date)
returns timestamptz
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select closes_at from tuckshop_order_window(p_for_date);
$$;

comment on function tuckshop_preorder_cutoff(date) is
  'When student ordering closes for a tuckshop date (from tuckshop_order_schedule); null if it is not a tuckshop day.';

create or replace function tuckshop_preorder_locked(p_for_date date)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(now() >= tuckshop_preorder_cutoff(p_for_date), true);
$$;

comment on function tuckshop_preorder_locked(date) is
  'True once ordering for that tuckshop date has closed — or if the date is not a tuckshop day at all.';

-- Upcoming ordering windows: open now, or still to open, soonest-closing
-- first. Looks p_days ahead.
create or replace function tuckshop_order_windows(p_days integer default 14)
returns table (for_date date, opens_at timestamptz, closes_at timestamptz, is_open boolean)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select d::date, w.opens_at, w.closes_at, now() >= w.opens_at and now() < w.closes_at
  from generate_series(
         (now() at time zone 'Africa/Lagos')::date,
         (now() at time zone 'Africa/Lagos')::date + p_days,
         interval '1 day'
       ) as d
  cross join lateral tuckshop_order_window(d::date) w
  where w.closes_at > now()
  order by w.closes_at;
$$;

comment on function tuckshop_order_windows(integer) is
  'Tuckshop ordering windows that are open now or still to come, soonest-closing first.';

create or replace function tuckshop_next_order_date()
returns date
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select for_date from tuckshop_order_windows(14)
  order by is_open desc, closes_at
  limit 1;
$$;

comment on function tuckshop_next_order_date() is
  'The tuckshop date whose ordering window is open now, or else the next one to open.';

grant execute on function tuckshop_order_window(date) to authenticated;
grant execute on function tuckshop_order_windows(integer) to authenticated;

-- As migration 186, with the timing checks now from the schedule.
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
  v_win record;
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

  select x.item_id into v_bad
  from jsonb_to_recordset(p_items) as x(item_id bigint, quantity integer)
  left join tuckshop_items t on t.id = x.item_id
  where t.id is null or (not t.active and not v_is_staff)
  limit 1;
  if found then
    raise exception 'One of the items in this order is no longer sold — remove it and try again';
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
  having sum(b.quantity) > 2
  limit 1;
  if found then
    raise exception 'You can order at most 2 of each item for one tuckshop day — that would make % %.',
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
    raise exception 'You can order at most 2 snacks and drinks in total for one tuckshop day — that would make %.',
      v_food;
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

comment on function save_tuckshop_order(integer, date, jsonb) is
  'Replace a student''s tuckshop order for a tuckshop day with the given basket ([] cancels it). Enforces the manual closure, the ordering window from tuckshop_order_schedule, 2 of each item and 2 snacks/drinks in total.';
