-- 229_tuckshop_hand_out_save_lock.sql
--
-- Hand Out Orders (/tuckshop/hand-out, migration 228) gets a Save that
-- confirms a restaurant's deliveries for the day and locks them, and a new
-- `tuckshop_owner` role, the only one that can unlock.
--
-- Asked for on Sun 27 Sep 2026, straight after 228 went live: "There needs
-- to be a save to confirm and commit the delivery otherwise tuckshop could
-- go back and change it. Once saved only Cs@ should be able to unlock. This
-- is the role of tuckshop owner." cs@abc.sch.ng is Uju MBA (staff 151), who
-- is given the role here.
--
-- How it works:
--   * tuckshop_handout_saves has one row per save of a restaurant's list
--     for a tuckshop day. The list is locked while its latest row has no
--     unlocked_at. Unlocking fills unlocked_at/unlocked_by instead of
--     deleting, so every save and unlock stays on record. A partial unique
--     index allows only one open (locked) save per restaurant and day.
--   * The restaurant is the student's students.restaurant, '' for none,
--     the same grouping the page and the order sheets use.
--   * While locked, set_tuckshop_orders_given() refuses to mark or undo
--     any order in it. fulfill_tuckshop_preorder() (the old Fulfil button
--     on /tuckshop/preorders) refuses too, so the lock can't be bypassed
--     from the other page.
--   * Saving is for tuckshop, bursar, the owner and admins. Marking orders
--     stays tuckshop/bursar/admin, as in 228 (record_tuckshop_purchase()
--     checks the same). The owner's account is an admin one anyway.
--     Unlocking checks staff_roles for 'tuckshop_owner' directly, not
--     user_has_staff_role(), which every admin passes. So "only the
--     tuckshop owner" means exactly that, admins included.
--   * The table is written only by the two SECURITY DEFINER functions, so
--     authenticated gets SELECT only. saved_by / unlocked_by come from
--     auth.uid() inside the functions, never from the browser.

set local formwork.change_note = 'Principal (direct)';

-- The role -----------------------------------------------------------------

insert into public.roles (role_name, description) values
  ('tuckshop_owner', 'Owns the tuckshop; the only role that can unlock a saved hand-out list')
on conflict (role_name) do nothing;

insert into public.staff_roles (staff_id, role_name)
select staff_id, 'tuckshop_owner' from public.staff where lower(email) = 'cs@abc.sch.ng'
on conflict do nothing;

-- The owner sees the tuckshop pages the tuckshop role sees.
insert into public.role_permissions (role_name, resource_key)
select 'tuckshop_owner', resource_key from public.role_permissions where role_name = 'tuckshop'
on conflict do nothing;

create or replace function public.is_tuckshop_owner()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from profiles p join staff_roles sr on sr.staff_id = p.staff_id
    where p.id = auth.uid() and sr.role_name = 'tuckshop_owner'
  );
$$;

grant execute on function public.is_tuckshop_owner() to authenticated;

-- Saves ----------------------------------------------------------------------

create table public.tuckshop_handout_saves (
  id bigint generated always as identity primary key,
  for_date date not null,
  restaurant text not null default '',
  given_count integer not null,
  not_given_count integer not null,
  given_value numeric not null,
  saved_at timestamptz not null default now(),
  saved_by uuid references auth.users(id),
  unlocked_at timestamptz,
  unlocked_by uuid references auth.users(id)
);

create unique index tuckshop_handout_saves_one_open
  on public.tuckshop_handout_saves (for_date, restaurant) where unlocked_at is null;

-- Belt and braces: the functions already pass auth.uid(), and stamp_actor()
-- (migration 214) makes sure nothing else can end up there.
create trigger trg_stamp_saved_by before insert on public.tuckshop_handout_saves
  for each row execute function stamp_actor('saved_by');
create trigger trg_stamp_unlocked_by before update of unlocked_at on public.tuckshop_handout_saves
  for each row execute function stamp_actor('unlocked_by');

alter table public.tuckshop_handout_saves enable row level security;
grant select on public.tuckshop_handout_saves to authenticated;

create policy "Tuckshop staff read hand-out saves" on public.tuckshop_handout_saves
  for select using (user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']));

comment on table public.tuckshop_handout_saves is
  'Hand Out Orders: each save (lock) of a restaurant''s list for a tuckshop day, and when/who unlocked it. Written only by save_/unlock_tuckshop_handout().';

-- Is this student's order for that day in a saved (locked) list?
create or replace function public.tuckshop_handout_locked(p_student_id integer, p_for_date date)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from tuckshop_handout_saves h
    join students s on coalesce(s.restaurant, '') = h.restaurant
    where s.student_id = p_student_id and h.for_date = p_for_date and h.unlocked_at is null
  );
$$;

revoke execute on function public.tuckshop_handout_locked(integer, date) from public, anon, authenticated;

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
  if not user_has_staff_role(array['tuckshop', 'bursar', 'tuckshop_owner']) then
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

revoke execute on function public.save_tuckshop_handout(date, text) from public, anon;
grant execute on function public.save_tuckshop_handout(date, text) to authenticated;

create or replace function public.unlock_tuckshop_handout(p_for_date date, p_restaurant text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not is_tuckshop_owner() then
    raise exception 'Only the tuckshop owner can unlock a saved hand-out list';
  end if;

  update tuckshop_handout_saves
  set unlocked_at = now(), unlocked_by = auth.uid()
  where for_date = p_for_date and restaurant = coalesce(p_restaurant, '') and unlocked_at is null;

  if not found then
    raise exception 'That list isn''t locked';
  end if;
end;
$function$;

revoke execute on function public.unlock_tuckshop_handout(date, text) from public, anon;
grant execute on function public.unlock_tuckshop_handout(date, text) to authenticated;

-- The lock, enforced where orders are marked -------------------------------

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
  if not user_has_staff_role(array['tuckshop', 'bursar']) then
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

-- As live, plus the lock.
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
  if not user_has_staff_role(array['tuckshop', 'bursar']) then
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
