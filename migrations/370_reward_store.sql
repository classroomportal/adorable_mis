-- Migration 370: Reward Store, stage 1 (spend merit points).
--
-- Why (the principal, 5 Oct 2026): "a reward store where students can use the
-- merit points to purchase things. The merit total for our records and reports
-- needs to stay but their buying points go down." Design and decisions in
-- docs/reward-store-design.md; the principal agreed every recommendation:
--   1. Negative points don't reduce points to spend.
--   2. Merits from 1 Sept 2026 count, and points to spend start again each
--      academic year (only the current year's merits and purchases count).
--   3. Parents will see purchases read-only (stage 2, not here).
--   4. The tuckshop reward is a visit only; points never become money.
--   5. Assistant for a day: one student a day, the approver names the member
--      of staff (the link to attendance is stage 3).
--   6. Approvers are set per reward (mufti: pastoral, head of boarding;
--      tuckshop visit: tuckshop; assistant: SMT), editable.
--   8. The catalogue is managed by SMT and pastoral, as ticks on
--      /admin/permissions.
--
-- How:
--  * behaviour_events is never touched. Purchases are their own ledger
--    (reward_purchases), so certificates, Behaviour Totals and reports read
--    exactly what they read before.
--  * Points to spend = positive, non-voided merits this academic year (from
--    reward_settings.points_count_from) minus purchases this year that hold
--    points (requested, approved, used). Worked out every time by
--    reward_points(), never stored, so a merit voided or deleted later fixes
--    the balance by itself (it can then go below zero; nothing is clawed
--    back, the student just can't buy until it is positive again).
--  * reward_purchases has select policies only. Every change goes through
--    buy_reward(), cancel_reward(), decide_reward() and mark_reward_used(),
--    which identify the caller through auth.uid(). buy_reward() takes the
--    student from my_student_id(), never from the request, and takes an
--    advisory lock per student so two taps can't spend the same points twice.
--  * Prices, limits, dates and approvers are data in reward_items. Changing a
--    price doesn't change purchases already made (cost is copied).
--  * Nothing is deleted: rewards are retired (active = false), purchases are
--    cancelled or declined. Both tables are logged in change_history under a
--    new area 'rewards'.

set local formwork.change_note = 'Principal (direct)';

-- ---- Settings (one row) -----------------------------------------------------

create table public.reward_settings (
  id boolean primary key default true check (id),
  store_open boolean not null default true,
  -- Merits before this date can't be spent (logging began 21 Sept 2026).
  points_count_from date not null default date '2026-09-01',
  updated_at timestamptz not null default now()
);

alter table public.reward_settings enable row level security;
grant select, update on public.reward_settings to authenticated;

create policy reward_settings_read on public.reward_settings
  for select to authenticated using (true);
create policy reward_settings_edit on public.reward_settings
  for update to authenticated
  using ((select has_ability('reward_items', 'edit')))
  with check ((select has_ability('reward_items', 'edit')));

insert into public.reward_settings (id) values (true);

-- ---- The catalogue -----------------------------------------------------------

create table public.reward_items (
  item_id serial primary key,
  position integer not null default 0,
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  description text check (description is null or length(description) <= 600),
  icon text check (icon is null or length(icon) <= 8),
  cost integer not null check (cost > 0),
  -- Which date the student picks: null = no date; 'school_day' = Mon–Fri in
  -- term, not a holiday; 'term_day' = any day in term, not a holiday.
  date_rule text check (date_rule in ('school_day', 'term_day')),
  -- How far ahead a date can be chosen.
  days_ahead integer not null default 28 check (days_ahead between 1 and 120),
  year_groups integer[],            -- null = every year
  per_student_limit integer check (per_student_limit is null or per_student_limit > 0),
  limit_period text not null default 'term'
    check (limit_period in ('week', 'fortnight', 'half_term', 'term', 'year')),
  per_day_capacity integer check (per_day_capacity is null or per_day_capacity > 0),
  approver_roles text[] not null default array['smt']
    check (cardinality(approver_roles) > 0),
  -- The approver must name a member of staff (assistant for a day).
  needs_staff boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

alter table public.reward_items enable row level security;
grant select, insert, update on public.reward_items to authenticated;
grant usage on sequence public.reward_items_item_id_seq to authenticated;

-- Everyone signed in reads the catalogue (students shop from it).
create policy reward_items_read on public.reward_items
  for select to authenticated using (true);
create policy ability_add on public.reward_items
  for insert to authenticated with check ((select has_ability('reward_items', 'add')));
create policy ability_edit on public.reward_items
  for update to authenticated
  using ((select has_ability('reward_items', 'edit')))
  with check ((select has_ability('reward_items', 'edit')));

create trigger trg_stamp_created_by before insert on public.reward_items
  for each row execute function stamp_actor('created_by');

-- Approver roles must be real staff roles.
create or replace function public.reward_items_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  new.name := btrim(new.name);
  if exists (select 1 from unnest(new.approver_roles) r
             where r not in (select role_name from roles)) then
    raise exception 'Approvers must be staff roles.';
  end if;
  if new.per_day_capacity is not null and new.date_rule is null then
    raise exception 'A limit per day needs the reward to have a date.';
  end if;
  return new;
end;
$$;

revoke execute on function public.reward_items_check() from public, anon, authenticated;

create trigger trg_reward_items_check before insert or update on public.reward_items
  for each row execute function public.reward_items_check();

insert into public.reward_items
  (position, name, icon, description, cost, date_rule, per_student_limit, limit_period,
   per_day_capacity, approver_roles, needs_staff) values
  (1, 'Mufti day', '👕',
   'Come to school in your own clothes for one school day. Clothes must be smart and suitable for school; staff can send you to change.',
   40, 'school_day', 1, 'half_term', null, array['pastoral', 'head_of_boarding'], false),
  (2, 'Extra tuckshop visit', '🍭',
   'An extra visit to the tuckshop. What you buy is still paid from your tuckshop balance.',
   25, 'term_day', 1, 'fortnight', null, array['tuckshop', 'tuckshop_owner'], false),
  (3, 'Assistant for a day', '🧑‍💼',
   'Spend a school day helping a member of staff (the office, the library, a lab, a head of department or the principal). The school chooses who you help and tells you.',
   100, 'school_day', 1, 'term', 1, array['smt'], true);

-- ---- Purchases (the ledger) --------------------------------------------------

create table public.reward_purchases (
  purchase_id bigserial primary key,
  student_id integer not null references public.students(student_id),
  item_id integer not null references public.reward_items(item_id),
  academic_year_id integer not null references public.academic_years(academic_year_id),
  cost integer not null check (cost > 0),
  for_date date,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'declined', 'cancelled', 'used')),
  created_at timestamptz not null default now(),
  decided_by integer references public.staff(staff_id),
  decided_at timestamptz,
  decline_reason text,
  assigned_staff_id integer references public.staff(staff_id),
  cancelled_by uuid,
  cancelled_at timestamptz,
  used_by integer references public.staff(staff_id),
  used_at timestamptz
);

create index reward_purchases_student on public.reward_purchases (student_id, academic_year_id);
create index reward_purchases_item_date on public.reward_purchases (item_id, for_date);
create index reward_purchases_status on public.reward_purchases (status);

alter table public.reward_purchases enable row level security;
grant select on public.reward_purchases to authenticated;

create policy reward_purchases_student_read on public.reward_purchases
  for select to authenticated using (student_id = (select my_student_id()));
create policy reward_purchases_staff_read on public.reward_purchases
  for select to authenticated using ((select is_staff_or_admin()));

-- ---- Logging -----------------------------------------------------------------

alter table public.change_history drop constraint change_history_area_check;
alter table public.change_history add constraint change_history_area_check check (area = any (array[
  'registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions', 'groups',
  'students', 'reading_ages', 'finance', 'prep', 'rewards']));

create trigger trg_log_change after insert or update or delete on public.reward_items
  for each row execute function log_change('rewards', 'item_id');
create trigger trg_log_change after update or delete on public.reward_settings
  for each row execute function log_change('rewards', 'id');
create trigger trg_log_change after insert or update or delete on public.reward_purchases
  for each row execute function log_change('rewards', 'purchase_id');

-- ---- Helpers -----------------------------------------------------------------

create or replace function public.reward_current_year()
returns academic_years
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select * from academic_years where status = 'current' order by start_date desc limit 1;
$$;

revoke execute on function public.reward_current_year() from public, anon, authenticated;

-- Earned, held and left to spend for one student this academic year.
-- The student themself, or any member of staff.
create or replace function public.reward_points(p_student_id integer default null)
returns table (earned integer, held integer, balance integer, merit_total integer)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_student integer := coalesce(p_student_id, my_student_id());
  v_year academic_years;
  v_from date;
begin
  if v_student is null then
    return;
  end if;
  if v_student is distinct from my_student_id() and not is_staff_or_admin() then
    return;
  end if;
  v_year := reward_current_year();
  select greatest(v_year.start_date, s.points_count_from) into v_from from reward_settings s;

  return query
  with e as (
    select coalesce(sum(be.points) filter (where be.event_date >= v_from), 0)::integer as earned,
           coalesce(sum(be.points), 0)::integer as merit_total
    from behaviour_events be
    where be.student_id = v_student and be.type = 'positive' and be.voided_at is null
      and be.points > 0
      and be.event_date >= v_year.start_date and be.event_date <= v_year.end_date
  ),
  h as (
    select coalesce(sum(rp.cost), 0)::integer as held
    from reward_purchases rp
    where rp.student_id = v_student and rp.academic_year_id = v_year.academic_year_id
      and rp.status in ('requested', 'approved', 'used')
  )
  select e.earned, h.held, e.earned - h.held, e.merit_total from e, h;
end;
$$;

revoke execute on function public.reward_points(integer) from public, anon;
grant execute on function public.reward_points(integer) to authenticated;

-- Is this date one the reward can be had on? Not checking capacity.
create or replace function public.reward_date_allowed(p_rule text, p_date date)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p_date is not null
    and exists (select 1 from terms t where p_date between t.start_date and t.end_date)
    and not exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = p_date)
    and (p_rule = 'term_day' or extract(isodow from p_date) between 1 and 5);
$$;

revoke execute on function public.reward_date_allowed(text, date) from public, anon, authenticated;

-- The period a date falls in for a per-student limit: [from, to].
-- half_term splits the term at its mid-term break (the first 'holiday'
-- calendar event named "Mid…term" inside the term), or at the term's middle
-- day if it has none; week and fortnight are the 7 or 14 days around the date.
create or replace function public.reward_limit_window(p_period text, p_date date)
returns table (win_from date, win_to date)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  t terms;
  v_mid date;
  y academic_years;
begin
  if p_period = 'week' then
    return query select p_date - 6, p_date + 6;
  elsif p_period = 'fortnight' then
    return query select p_date - 13, p_date + 13;
  elsif p_period in ('half_term', 'term') then
    select * into t from terms where p_date between start_date and end_date limit 1;
    if not found then
      return query select p_date, p_date;
      return;
    end if;
    if p_period = 'term' then
      return query select t.start_date, t.end_date;
    else
      select min(ce.event_date) - 1 into v_mid
      from calendar_events ce
      where ce.category = 'holiday' and ce.event_name ilike 'mid%term%'
        and ce.event_date between t.start_date and t.end_date;
      v_mid := coalesce(v_mid, t.start_date + (t.end_date - t.start_date) / 2);
      if p_date <= v_mid then
        return query select t.start_date, v_mid;
      else
        return query select v_mid + 1, t.end_date;
      end if;
    end if;
  else
    y := reward_current_year();
    return query select y.start_date, y.end_date;
  end if;
end;
$$;

revoke execute on function public.reward_limit_window(text, date) from public, anon, authenticated;

-- Why the signed-in student can't buy this reward for this date, or null.
create or replace function public.reward_buy_problem(
  p_student_id integer, p_item reward_items, p_date date, p_check_date boolean default true)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_year integer;
  v_balance integer;
  v_used integer;
  v_taken integer;
  w record;
  v_open boolean;
begin
  select store_open into v_open from reward_settings;
  if not coalesce(v_open, false) then
    return 'The Reward Store is closed at the moment.';
  end if;
  if not p_item.active then
    return 'This reward isn''t available any more.';
  end if;
  select year_group into v_year from students where student_id = p_student_id and status = 'active';
  if not found then
    return 'Only students at the school can buy rewards.';
  end if;
  if p_item.year_groups is not null and not (v_year = any (p_item.year_groups)) then
    return 'This reward isn''t for your year group.';
  end if;
  select balance into v_balance from reward_points(p_student_id);
  if coalesce(v_balance, 0) < p_item.cost then
    return format('You need %s points and have %s.', p_item.cost, greatest(coalesce(v_balance, 0), 0));
  end if;
  -- The store's list asks without a day for a dated reward; the days are
  -- checked one by one by my_reward_dates().
  if not p_check_date and p_item.date_rule is not null then
    return null;
  end if;

  if p_item.date_rule is not null then
    if p_date is null then
      return 'Please choose a day.';
    end if;
    if p_date < school_today() or p_date > school_today() + p_item.days_ahead then
      return format('Choose a day from today up to %s days ahead.', p_item.days_ahead);
    end if;
    if not reward_date_allowed(p_item.date_rule, p_date) then
      return case p_item.date_rule when 'school_day' then 'Choose a school day (Monday to Friday, in term).'
                                   else 'Choose a day in term.' end;
    end if;
    if p_item.per_day_capacity is not null then
      select count(*) into v_taken from reward_purchases
      where item_id = p_item.item_id and for_date = p_date and status in ('requested', 'approved', 'used');
      if v_taken >= p_item.per_day_capacity then
        return 'That day is full. Choose another day.';
      end if;
    end if;
  elsif p_date is not null then
    return 'This reward doesn''t take a date.';
  end if;

  if p_item.per_student_limit is not null then
    select * into w from reward_limit_window(p_item.limit_period, coalesce(p_date, school_today()));
    select count(*) into v_used from reward_purchases
    where student_id = p_student_id and item_id = p_item.item_id
      and status in ('requested', 'approved', 'used')
      and coalesce(for_date, (created_at at time zone 'Africa/Lagos')::date) between w.win_from and w.win_to;
    if v_used >= p_item.per_student_limit then
      return format('You can have this %s a %s.',
        case p_item.per_student_limit when 1 then 'once' when 2 then 'twice' else p_item.per_student_limit || ' times' end,
        case p_item.limit_period when 'half_term' then 'half term' else p_item.limit_period end);
    end if;
  end if;

  return null;
end;
$$;

revoke execute on function public.reward_buy_problem(integer, reward_items, date, boolean) from public, anon, authenticated;

-- The signed-in student's view of the store: every active reward for their
-- year, with whether they can buy it now (for a dated reward: on any open day).
create or replace function public.my_reward_store()
returns table (item_id integer, name text, description text, icon text, cost integer,
               date_rule text, days_ahead integer, per_student_limit integer, limit_period text,
               problem text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_student integer := my_student_id();
begin
  if v_student is null then
    return;
  end if;
  return query
  select i.item_id, i.name, i.description, i.icon, i.cost, i.date_rule, i.days_ahead,
         i.per_student_limit, i.limit_period,
         coalesce(
           reward_buy_problem(v_student, i, null, false),
           case when i.date_rule is not null and not exists (
                  select 1 from generate_series(0, i.days_ahead) n
                  where reward_buy_problem(v_student, i, school_today() + n) is null)
                then format('No days left to choose in the next %s days: you may have had this already, or the days are full.', i.days_ahead)
           end)
  from reward_items i
  join students s on s.student_id = v_student
  where i.active and (i.year_groups is null or s.year_group = any (i.year_groups))
  order by i.position, i.item_id;
end;
$$;

revoke execute on function public.my_reward_store() from public, anon;
grant execute on function public.my_reward_store() to authenticated;

-- The days the signed-in student could choose for a dated reward.
create or replace function public.my_reward_dates(p_item_id integer)
returns table (day date)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_student integer := my_student_id();
  i reward_items;
begin
  select * into i from reward_items where item_id = p_item_id;
  if v_student is null or not found or i.date_rule is null then
    return;
  end if;
  return query
  select d.day from (select school_today() + n as day from generate_series(0, i.days_ahead) n) d
  where reward_buy_problem(v_student, i, d.day) is null
  order by d.day;
end;
$$;

revoke execute on function public.my_reward_dates(integer) from public, anon;
grant execute on function public.my_reward_dates(integer) to authenticated;

-- Profiles of the staff who can decide a reward (its approver roles).
create or replace function public.reward_approver_profiles(p_item reward_items)
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select array_agg(distinct p.id)
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where sr.role_name = any (p_item.approver_roles);
$$;

revoke execute on function public.reward_approver_profiles(reward_items) from public, anon, authenticated;

-- Can the signed-in member of staff decide this purchase? Their roles must
-- include one of the reward's approvers (or admin), and it can't be their
-- own child.
create or replace function public.can_decide_reward(p_purchase_id bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from reward_purchases rp
    join reward_items i on i.item_id = rp.item_id
    where rp.purchase_id = p_purchase_id
      and (is_admin() or has_staff_role(i.approver_roles))
      and not exists (
        select 1 from profiles p
        join student_parent sp on sp.parent_id = p.parent_id
        where p.id = auth.uid() and sp.student_id = rp.student_id));
$$;

revoke execute on function public.can_decide_reward(bigint) from public, anon;
grant execute on function public.can_decide_reward(bigint) to authenticated;

-- ---- Actions -----------------------------------------------------------------

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
    'Reward request: ' || i.name,
    '<p>' || html_escape(v_name) || ' has used ' || i.cost || ' merit points for <strong>'
      || html_escape(i.name) || '</strong>'
      || coalesce(' on ' || to_char(p_for_date, 'FMDay FMDD FMMonth'), '')
      || '.</p><p>Approve or decline it on the Reward Store page (/rewards).</p>',
    'reward');
  return v_id;
end;
$$;

revoke execute on function public.buy_reward(integer, date) from public, anon;
grant execute on function public.buy_reward(integer, date) to authenticated;

-- Approve or decline a request. Declining gives the points back.
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
    raise exception 'This request has already been decided.';
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
    v_html := '<p>Your request for <strong>' || html_escape(i.name) || '</strong>'
      || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
      || ' has been approved.</p>'
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
    v_html := '<p>Your request for <strong>' || html_escape(i.name) || '</strong>'
      || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
      || ' was declined, and your ' || rp.cost || ' points are back.</p><p>Reason: '
      || html_escape(btrim(p_reason)) || '</p>';
  end if;

  perform post_inbox_notice(
    (select array_agg(id) from profiles where student_id = rp.student_id),
    'Reward Store: ' || i.name || case when p_approve then ' approved' else ' declined' end,
    v_html, 'reward');
end;
$$;

revoke execute on function public.decide_reward(bigint, boolean, text, integer) from public, anon;
grant execute on function public.decide_reward(bigint, boolean, text, integer) to authenticated;

-- Cancel: the student, while still requested; an approver, while requested or
-- approved (with a reason, e.g. the day was cancelled). The points come back.
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
      raise exception 'Only a request that hasn''t been decided yet can be cancelled. Ask a member of staff.';
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
      '<p>Your <strong>' || html_escape(i.name) || '</strong>'
        || coalesce(' on ' || to_char(rp.for_date, 'FMDay FMDD FMMonth'), '')
        || ' has been cancelled, and your ' || rp.cost || ' points are back.</p><p>Reason: '
        || html_escape(btrim(p_reason)) || '</p>',
      'reward');
  end if;
end;
$$;

revoke execute on function public.cancel_reward(bigint, text) from public, anon;
grant execute on function public.cancel_reward(bigint, text) to authenticated;

-- The reward has happened. Only once approved, and not before its day.
create or replace function public.mark_reward_used(p_purchase_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  rp reward_purchases;
begin
  select * into rp from reward_purchases where purchase_id = p_purchase_id for update;
  if not found then
    raise exception 'That request doesn''t exist.';
  end if;
  if not can_decide_reward(p_purchase_id) then
    raise exception 'You can''t mark this reward as used.';
  end if;
  if rp.status <> 'approved' then
    raise exception 'Only an approved reward can be marked as used.';
  end if;
  if rp.for_date is not null and rp.for_date > school_today() then
    raise exception 'This reward is for %; it can be marked as used from that day.', to_char(rp.for_date, 'FMDD FMMonth');
  end if;
  update reward_purchases
  set status = 'used', used_at = now(),
      used_by = (select staff_id from profiles where id = auth.uid())
  where purchase_id = p_purchase_id;
end;
$$;

revoke execute on function public.mark_reward_used(bigint) from public, anon;
grant execute on function public.mark_reward_used(bigint) to authenticated;

-- ---- Pages -------------------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order) values
  ('/rewards', 'Reward Store', 'Pastoral', 25),
  ('/rewards/items', 'Reward Store: Rewards', 'Pastoral', 26)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('smt', '/rewards'),
  ('pastoral', '/rewards'),
  ('head_of_boarding', '/rewards'),
  ('tuckshop', '/rewards'),
  ('tuckshop_owner', '/rewards'),
  ('smt', '/rewards/items'),
  ('pastoral', '/rewards/items')
on conflict do nothing;

-- ---- /admin/permissions --------------------------------------------------------

insert into public.role_ability_tables (table_name, stage) values
  ('reward_items', 8), ('reward_purchases', 8)
on conflict (table_name) do nothing;

insert into public.role_abilities (role_name, table_name, action)
select r, 'reward_items', a
from unnest(array['smt', 'pastoral', 'admin']) r
cross join unnest(array['add', 'edit']) a
on conflict do nothing;

insert into public.role_ability_locks (table_name, action, reason) values
  ('reward_items', 'view', 'Everyone signed in: students shop from it (fixed rule)'),
  ('reward_items', 'delete', 'Never deleted; retired instead (the principal)'),
  ('reward_purchases', 'view', 'All staff, and each student their own (fixed rule)'),
  ('reward_purchases', 'add', 'Only a student buying for themself, through the store (fixed rule)'),
  ('reward_purchases', 'edit', 'Only the reward''s approvers, through the store''s own steps (fixed rule)'),
  ('reward_purchases', 'delete', 'Never deleted; cancelled or declined instead (the principal)')
on conflict (table_name, action) do nothing;
