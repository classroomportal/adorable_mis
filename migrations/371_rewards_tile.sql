-- Migration 371: a Rewards card on the staff dashboard.
--
-- Why: the principal, 5 Oct 2026: "Create a big tile for rewards. Move
-- certificates onto it as well as reward store related issue. There needs be
-- orders acceptance there." The Rewards card (staff_modules, key 'rewards')
-- holds Orders (/rewards: accept or decline students' reward orders), Rewards
-- & Prices (/rewards/items) and Certificates (/certificates); all three come
-- off the Pastoral card (one place for each link). Who can open each page is
-- unchanged.
--
-- How:
--  * The card goes straight after Pastoral in the saved staff_modules order;
--    the later cards move down one. It can be moved at /admin/tile-order.
--  * dashboard_card_counts() gains reward_orders: orders waiting to be
--    accepted that the caller can decide (one of the reward's approver roles,
--    or admin; the same rule as can_decide_reward(), less the own-child check,
--    which only matters when deciding). Shown on the card as "Orders waiting".
--  * Orders wording: buy_reward(), decide_reward() and cancel_reward() now
--    send "order … accepted / declined / cancelled" notices; their rules are
--    unchanged.
--  * On /admin/permissions the three pages are grouped under "Rewards", and
--    /rewards is relabelled "Reward Orders".

set local formwork.change_note = 'Principal (direct)';

update public.dashboard_tile_order
   set position = position + 1
 where dashboard = 'staff_modules'
   and position > (select position from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'pastoral')
   and not exists (select 1 from public.dashboard_tile_order where dashboard = 'staff_modules' and tile_key = 'rewards');

insert into public.dashboard_tile_order (dashboard, tile_key, position)
select 'staff_modules', 'rewards', position + 1
  from public.dashboard_tile_order
 where dashboard = 'staff_modules' and tile_key = 'pastoral'
on conflict do nothing;

update public.resources set label = 'Reward Orders', section = 'Rewards' where resource_key = '/rewards';
update public.resources set label = 'Rewards & Prices', section = 'Rewards' where resource_key = '/rewards/items';
update public.resources set section = 'Rewards' where resource_key = '/certificates';

create or replace function public.dashboard_card_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_students integer;
  v_staff integer;
  v_alerts integer;
  v_orders integer;
begin
  if not is_staff_or_admin() then
    return jsonb_build_object('students', null, 'staff', null, 'behaviour_alerts', null, 'reward_orders', null);
  end if;

  if has_resource_access('/students') then
    select count(*) into v_students from students where status = 'active' and is_demo = false;
  end if;

  if has_resource_access('/staff/roles') then
    select count(*) into v_staff from staff where is_demo = false;
  end if;

  if has_resource_access('/behaviour') then
    select count(*) into v_alerts
    from behaviour_events
    where type = 'negative' and points <= -3 and voided_at is null and is_demo = false
      and event_date >= school_today() - 7;
  end if;

  if has_resource_access('/rewards') then
    select count(*) into v_orders
    from reward_purchases rp
    join reward_items i on i.item_id = rp.item_id
    where rp.status = 'requested'
      and (is_admin() or has_staff_role(i.approver_roles));
  end if;

  return jsonb_build_object('students', v_students, 'staff', v_staff, 'behaviour_alerts', v_alerts,
                            'reward_orders', v_orders);
end;
$$;

-- The inbox notices talk about orders being accepted, matching the card
-- (wording only; the rules are migration 370's).

create or replace function public.buy_reward(p_item_id integer, p_for_date date default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer := my_student_id();
  i reward_items;
  v_problem text;
  v_id bigint;
  v_name text;
begin
  if v_student is null then
    raise exception 'Only students can buy rewards.';
  end if;
  -- One purchase at a time per student, so the same points can't be spent twice.
  perform pg_advisory_xact_lock(hashtext('reward_purchase'), v_student);

  select * into i from reward_items where item_id = p_item_id;
  if not found then
    raise exception 'That reward doesn''t exist.';
  end if;
  v_problem := reward_buy_problem(v_student, i, p_for_date);
  if v_problem is not null then
    raise exception '%', v_problem;
  end if;

  insert into reward_purchases (student_id, item_id, academic_year_id, cost, for_date)
  values (v_student, i.item_id, (reward_current_year()).academic_year_id, i.cost, p_for_date)
  returning purchase_id into v_id;

  select first_name || ' ' || last_name || ' (Year ' || year_group || ')' into v_name
  from students where student_id = v_student;
  perform post_inbox_notice(
    reward_approver_profiles(i),
    'Reward order: ' || i.name,
    '<p>' || html_escape(v_name) || ' has ordered <strong>'
      || html_escape(i.name) || '</strong>'
      || coalesce(' for ' || to_char(p_for_date, 'FMDay FMDD FMMonth'), '')
      || ' with ' || i.cost || ' merit points.</p><p>Accept or decline it under Rewards, Orders (/rewards).</p>',
    'reward');
  return v_id;
end;
$$;

revoke execute on function public.buy_reward(integer, date) from public, anon;
grant execute on function public.buy_reward(integer, date) to authenticated;

create or replace function public.decide_reward(
  p_purchase_id bigint, p_approve boolean, p_reason text default null, p_staff_id integer default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  rp reward_purchases;
  i reward_items;
  v_me integer;
  v_staff_name text;
  v_html text;
begin
  select * into rp from reward_purchases where purchase_id = p_purchase_id for update;
  if not found then
    raise exception 'That request doesn''t exist.';
  end if;
  if not can_decide_reward(p_purchase_id) then
    raise exception 'You can''t decide this request.';
  end if;
  if rp.status <> 'requested' then
    raise exception 'This order has already been accepted or declined.';
  end if;
  select * into i from reward_items where item_id = rp.item_id;
  select staff_id into v_me from profiles where id = auth.uid();

  if p_approve then
    if i.needs_staff then
      if p_staff_id is null then
        raise exception 'Choose the member of staff the student will help.';
      end if;
      if not exists (select 1 from staff where staff_id = p_staff_id) then
        raise exception 'That member of staff doesn''t exist.';
      end if;
      select first_name || ' ' || last_name into v_staff_name from staff where staff_id = p_staff_id;
    elsif p_staff_id is not null then
      raise exception 'This reward doesn''t need a member of staff.';
    end if;
    update reward_purchases
    set status = 'approved', decided_by = v_me, decided_at = now(),
        assigned_staff_id = p_staff_id, decline_reason = null
    where purchase_id = p_purchase_id;
    v_html := '<p>Your order for <strong>' || html_escape(i.name) || '</strong>'
      || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
      || ' has been accepted.</p>'
      || coalesce('<p>You will be helping ' || html_escape(v_staff_name) || '.</p>', '');
    if p_staff_id is not null then
      perform post_inbox_notice(
        (select array_agg(id) from profiles where staff_id = p_staff_id),
        'Assistant for a day: ' || (select first_name || ' ' || last_name from students where student_id = rp.student_id),
        '<p>' || html_escape((select first_name || ' ' || last_name || ' (Year ' || year_group || ')' from students where student_id = rp.student_id))
          || ' will be your assistant for the day' || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
          || ', a reward bought with merit points.</p>',
        'reward');
    end if;
  else
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception 'Please give the student a reason.';
    end if;
    update reward_purchases
    set status = 'declined', decided_by = v_me, decided_at = now(), decline_reason = btrim(p_reason)
    where purchase_id = p_purchase_id;
    v_html := '<p>Your order for <strong>' || html_escape(i.name) || '</strong>'
      || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
      || ' was declined, and your ' || rp.cost || ' points are back.</p><p>Reason: '
      || html_escape(btrim(p_reason)) || '</p>';
  end if;

  perform post_inbox_notice(
    (select array_agg(id) from profiles where student_id = rp.student_id),
    'Reward Store: ' || i.name || case when p_approve then ' accepted' else ' declined' end,
    v_html, 'reward');
end;
$$;

revoke execute on function public.decide_reward(bigint, boolean, text, integer) from public, anon;
grant execute on function public.decide_reward(bigint, boolean, text, integer) to authenticated;

create or replace function public.cancel_reward(p_purchase_id bigint, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  rp reward_purchases;
  i reward_items;
  v_student boolean;
begin
  select * into rp from reward_purchases where purchase_id = p_purchase_id for update;
  if not found then
    raise exception 'That request doesn''t exist.';
  end if;
  v_student := rp.student_id = my_student_id();
  if v_student then
    if rp.status <> 'requested' then
      raise exception 'Only an order that hasn''t been accepted yet can be cancelled. Ask a member of staff.';
    end if;
  elsif can_decide_reward(p_purchase_id) then
    if rp.status not in ('requested', 'approved') then
      raise exception 'This request can''t be cancelled now.';
    end if;
    if nullif(btrim(coalesce(p_reason, '')), '') is null then
      raise exception 'Please give the student a reason.';
    end if;
  else
    raise exception 'You can''t cancel this request.';
  end if;

  update reward_purchases
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(),
      decline_reason = case when v_student then decline_reason else btrim(p_reason) end
  where purchase_id = p_purchase_id;

  if not v_student then
    select * into i from reward_items where item_id = rp.item_id;
    perform post_inbox_notice(
      (select array_agg(id) from profiles where student_id = rp.student_id),
      'Reward Store: ' || i.name || ' cancelled',
      '<p>Your order for <strong>' || html_escape(i.name) || '</strong>'
        || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
        || ' has been cancelled, and your ' || rp.cost || ' points are back.</p><p>Reason: '
        || html_escape(btrim(p_reason)) || '</p>',
      'reward');
  end if;
end;
$$;

revoke execute on function public.cancel_reward(bigint, text) from public, anon;
grant execute on function public.cancel_reward(bigint, text) to authenticated;
