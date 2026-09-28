-- 241_tuckshop_special_sessions.sql
--
-- Special tuckshop pre-order sessions: a one-off ordering window, set by
-- the tuckshop, with its own short list of items on sale.
--
-- Asked for on Mon 28 Sep 2026: "I need to create a special session when
-- only certain items will be for sale in the tuckshop as preorders. For
-- instance I need it open at 7 tonight Lagos time and close at 10, but I
-- will choose the list of items on sale. At the moment the previous
-- session is still being marked as delivered."
--
-- Until now the only ordering windows were the weekly rota
-- (tuckshop_order_schedule, migration 187), always selling every active
-- item, and the manual closure (migrations 119/120) shut everything.
--
-- How it works:
--   * tuckshop_special_sessions has one row per session: a name, the
--     delivery date (for_date, the date the orders are for, exactly like a
--     normal tuckshop day) and the moments ordering opens and closes. One
--     session per delivery date, so orders, order sheets and the hand-out
--     list for it are all keyed on that date as before, and never mix with
--     another tuckshop day's. That keeps a previous day still being handed
--     out (Sat 26 Sep at the time) completely separate.
--   * tuckshop_special_session_items is the list of items on sale in it.
--     Only those can be ordered for that date, and they can be ordered
--     even if the item is switched off for normal ordering
--     (tuckshop_items.active), since choosing it for the session is the
--     decision to sell it.
--   * tuckshop_order_window(date) returns the session's window for its
--     delivery date instead of the weekly rota's, so the lock, the portal,
--     the order sheets' "still open" and the error messages all follow it
--     with nothing else changed. A session on a normal tuckshop day
--     replaces that day's window.
--   * The manual closure doesn't apply to a special session: creating one
--     is itself the decision to open ordering for it. (At the time of
--     writing ordering is closed until Tue 29 Sep.)
--   * The 2-of-each-item and 2-snacks-and-drinks limits still apply per
--     delivery date, as for any tuckshop day.
--   * Written on /tuckshop/ordering by the same people who can edit the
--     weekly rota (tuckshop, bursar, admin). created_by is stamped from
--     auth.uid() by stamp_actor().

set local formwork.change_note = 'Principal (direct)';

create table if not exists public.tuckshop_special_sessions (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  for_date date not null unique,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint tuckshop_special_sessions_opens_before_closes check (opens_at < closes_at),
  -- The delivery date can't be before ordering opens.
  constraint tuckshop_special_sessions_delivered_after_opening
    check (for_date >= (opens_at at time zone 'Africa/Lagos')::date)
);

comment on table public.tuckshop_special_sessions is
  'One-off tuckshop pre-order sessions (migration 241): their own ordering window and item list for one delivery date, overriding the weekly schedule and the manual closure for that date. Edited on /tuckshop/ordering.';

create table if not exists public.tuckshop_special_session_items (
  session_id bigint not null references public.tuckshop_special_sessions(id) on delete cascade,
  tuckshop_item_id bigint not null references public.tuckshop_items(id),
  primary key (session_id, tuckshop_item_id)
);

comment on table public.tuckshop_special_session_items is
  'The items on sale in a special tuckshop session (migration 241). Only these can be ordered for its delivery date.';

alter table public.tuckshop_special_sessions enable row level security;
grant select, insert, update, delete on public.tuckshop_special_sessions to authenticated;

alter table public.tuckshop_special_session_items enable row level security;
grant select, insert, update, delete on public.tuckshop_special_session_items to authenticated;

create policy "Special tuckshop sessions readable by all authenticated"
  on public.tuckshop_special_sessions for select to authenticated
  using (true);

create policy "Special tuckshop sessions writable by tuckshop staff"
  on public.tuckshop_special_sessions for all to authenticated
  using (is_admin() or user_has_staff_role(array['tuckshop', 'bursar']))
  with check (is_admin() or user_has_staff_role(array['tuckshop', 'bursar']));

create policy "Special tuckshop session items readable by all authenticated"
  on public.tuckshop_special_session_items for select to authenticated
  using (true);

create policy "Special tuckshop session items writable by tuckshop staff"
  on public.tuckshop_special_session_items for all to authenticated
  using (is_admin() or user_has_staff_role(array['tuckshop', 'bursar']))
  with check (is_admin() or user_has_staff_role(array['tuckshop', 'bursar']));

create trigger trg_stamp_created_by
  before insert on public.tuckshop_special_sessions
  for each row execute function public.stamp_actor('created_by');

-- A special session's window wins over the weekly rota for its date.
create or replace function public.tuckshop_order_window(p_for_date date)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select ss.opens_at, ss.closes_at
  from tuckshop_special_sessions ss
  where ss.for_date = p_for_date
  union all
  select ((p_for_date - ((s.service_dow - s.opens_dow + 7) % 7)) + s.opens_time) at time zone 'Africa/Lagos',
         ((p_for_date - ((s.service_dow - s.closes_dow + 7) % 7)) + s.closes_time) at time zone 'Africa/Lagos'
  from tuckshop_order_schedule s
  where s.service_dow = extract(isodow from p_for_date)
    and not exists (select 1 from tuckshop_special_sessions ss where ss.for_date = p_for_date);
$$;

comment on function public.tuckshop_order_window(date) is
  'When student ordering opens and closes for a tuckshop date: the special session''s window if there is one for that date (migration 241), otherwise from tuckshop_order_schedule. No row if the date is not a tuckshop day.';

-- As migration 187, plus: a special session's date ignores the manual
-- closure and sells only the session's items.
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
begin
  v_is_staff := user_has_staff_role(array['tuckshop', 'bursar']);

  if not (
    v_is_staff
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
  ) then
    raise exception 'Not authorized to order for this student';
  end if;

  select id into v_special from tuckshop_special_sessions where for_date = p_for_date;

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

comment on function public.save_tuckshop_order(integer, date, jsonb) is
  'Replace a student''s tuckshop order for a tuckshop day with the given basket ([] cancels it). Enforces the manual closure (not on a special session''s date), the ordering window, the items on sale (a special session''s list, else active items), 2 of each item and 2 snacks/drinks in total.';
