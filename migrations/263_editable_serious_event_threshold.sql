-- Migration 263: the "serious event" threshold editable on Lookups.
--
-- Why: the principal asked (30 Sept 2026) for the serious-event threshold to
-- be editable too, after migration 262 made the detention and certificate
-- rules editable. A serious event (fixed at -5 until now) must have a
-- written explanation, and goes through the review at /behaviour/review
-- (school office; SMT when it has a picture) before parents can see it.
--
-- Changes:
--   * behaviour_rules.serious_event_points, seeded at -5 (today's rule).
--   * set_behaviour_rules() takes it as a sixth argument (the five-argument
--     version is dropped; the Lookups page is the only caller).
--   * edit_behaviour_event(), review_serious_behaviour_event() and
--     review_behaviour_for_parents() read it instead of -5. The pages that
--     require the explanation and list events for review read the same row
--     (lib/behaviourRules.js).
--   * Changing it changes nothing about events already logged or already
--     reviewed: an event that becomes "serious" under a new threshold is
--     simply listed for review if it hasn't been sent to parents.

set local formwork.change_note = 'Principal (direct)';

alter table public.behaviour_rules
  add column if not exists serious_event_points integer not null default -5 check (serious_event_points < 0);

drop function if exists public.set_behaviour_rules(integer, integer, integer, text, text);

create or replace function public.set_behaviour_rules(
  p_detention_single_event_points integer,
  p_detention_weekly_total_points integer,
  p_alert_weekly_total_points integer,
  p_detention_room text,
  p_detention_time text,
  p_serious_event_points integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change behaviour rules.';
  end if;
  if p_detention_single_event_points >= 0 or p_detention_weekly_total_points >= 0
     or p_alert_weekly_total_points >= 0 or p_serious_event_points >= 0 then
    raise exception 'Behaviour thresholds are negative points (e.g. -5).';
  end if;

  update behaviour_rules set
    detention_single_event_points = p_detention_single_event_points,
    detention_weekly_total_points = p_detention_weekly_total_points,
    alert_weekly_total_points = p_alert_weekly_total_points,
    serious_event_points = p_serious_event_points,
    updated_by = auth.uid(),
    updated_at = now()
  where id;

  update system_settings set
    detention_room = nullif(btrim(p_detention_room), ''),
    detention_time = nullif(btrim(p_detention_time), '');
end;
$$;

create or replace function public.review_serious_behaviour_event(p_event_id integer, p_visible_to_parents boolean, p_protocol_confirmed boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event behaviour_events%rowtype;
  v_reviewer_staff_id integer;
  r behaviour_rules;
begin
  if not (is_admin() or has_staff_role(array['school_office', 'smt'])) then
    raise exception 'Only school office staff, SMT or admin can review a behaviour event';
  end if;
  select * into r from behaviour_rules where id;

  select * into v_event from behaviour_events where event_id = p_event_id;
  if not found then
    raise exception 'Behaviour event % not found', p_event_id;
  end if;

  if v_event.photo_id is not null then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can review a behaviour event';
  end if;

  if v_event.type <> 'negative' or v_event.points > r.serious_event_points then
    raise exception 'Only serious (negative, % point) events go through this review', r.serious_event_points;
  end if;

  if p_visible_to_parents and not p_protocol_confirmed then
    raise exception 'Protocol confirmation is required before releasing this event to parents';
  end if;

  select staff_id into v_reviewer_staff_id from profiles where id = auth.uid();

  update behaviour_events
  set visible_to_parents = p_visible_to_parents,
      protocol_reviewed_by = v_reviewer_staff_id,
      protocol_reviewed_at = now()
  where event_id = p_event_id;
end;
$$;

create or replace function public.review_behaviour_for_parents(p_event_ids integer[], p_send_text boolean, p_send_picture boolean, p_protocol_confirmed boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_reviewer integer;
  v_found integer;
  r behaviour_rules;
begin
  if p_event_ids is null or cardinality(p_event_ids) = 0 then
    raise exception 'No behaviour events given.';
  end if;
  select * into r from behaviour_rules where id;

  if exists (select 1 from behaviour_events where event_id = any(p_event_ids) and photo_id is not null) then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can send a behaviour event to parents'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_found
  from behaviour_events
  where event_id = any(p_event_ids) and voided_at is null;
  if v_found <> cardinality(array(select distinct unnest(p_event_ids))) then
    raise exception 'Behaviour event not found, or it has been withdrawn.';
  end if;

  if p_send_text and not coalesce(p_protocol_confirmed, false) then
    raise exception 'Protocol confirmation is required before sending the text to parents';
  end if;

  if p_send_text and exists (
    select 1 from behaviour_events
    where event_id = any(p_event_ids)
      and type = 'negative' and points > r.serious_event_points and photo_id is null
  ) then
    raise exception 'Only serious (% point) events, or events with a picture, can be sent to parents from the review', r.serious_event_points;
  end if;

  if p_send_picture is not null and exists (
    select 1 from behaviour_events where event_id = any(p_event_ids) and photo_id is null
  ) then
    raise exception 'This behaviour event has no picture.';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  if p_send_text is not null then
    update behaviour_events
    set visible_to_parents = p_send_text,
        protocol_reviewed_by = v_reviewer,
        protocol_reviewed_at = now()
    where event_id = any(p_event_ids)
      and type = 'negative';
  end if;

  if p_send_picture is not null then
    update behaviour_photos
    set status = case when p_send_picture then 'approved' else 'rejected' end,
        reviewed_by = v_reviewer,
        reviewed_at = now()
    where photo_id in (
      select photo_id from behaviour_events where event_id = any(p_event_ids)
    );
  end if;
end;
$$;

create or replace function public.edit_behaviour_event(p_event_id integer, p_category text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event behaviour_events%rowtype;
  v_my_staff_id integer;
  v_category text := coalesce(nullif(btrim(p_category), ''), null);
  v_description text := nullif(btrim(p_description), '');
  v_points integer;
  v_week_start date;
  v_friday date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_week_total integer;
  v_added integer := 0;
  v_cancelled integer := 0;
  v_n integer;
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;
  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;
  if v_event.voided_at is not null then
    raise exception 'This event was withdrawn on appeal and can no longer be edited.';
  end if;

  select staff_id into v_my_staff_id from profiles where id = auth.uid();
  if not (is_pastoral_or_smt()
          or has_staff_role(array['school_office'])
          or (v_my_staff_id is not null and v_my_staff_id = v_event.staff_id)) then
    raise exception 'Only the member of staff who logged this event, pastoral/SMT or the school office can edit it.'
      using errcode = 'insufficient_privilege';
  end if;

  v_category := coalesce(v_category, v_event.category);
  select default_points into v_points
  from behaviour_categories where name = v_category and type = v_event.type;
  if v_points is null then
    raise exception 'Choose a % behaviour category.', v_event.type;
  end if;
  if v_points <= r.serious_event_points and v_description is null then
    raise exception 'A serious event (% points or worse) needs an explanation of what happened.', r.serious_event_points;
  end if;

  if v_category is not distinct from v_event.category
     and v_description is not distinct from v_event.description then
    return jsonb_build_object('changed', false, 'detentions_added', 0, 'detentions_cancelled', 0);
  end if;

  update behaviour_events
  set category = v_category, points = v_points, description = v_description
  where event_id = p_event_id;

  insert into behaviour_event_audit (event_id, changed_by, old_values, new_values)
  values (p_event_id, auth.uid(),
          jsonb_build_object('category', v_event.category, 'points', v_event.points, 'description', v_event.description),
          jsonb_build_object('category', v_category, 'points', v_points, 'description', v_description));

  if v_event.type = 'negative' and v_points is distinct from v_event.points then
    v_week_start := v_event.event_date - ((extract(dow from v_event.event_date)::int - 6 + 7) % 7);
    v_friday := v_week_start + 6;

    if v_points <= r.detention_single_event_points then
      if v_friday >= v_today then
        update detentions set status = 'scheduled'
        where behaviour_event_id = p_event_id and status = 'cancelled';
        get diagnostics v_n = row_count;
        if v_n = 0 and not exists (select 1 from detentions where behaviour_event_id = p_event_id) then
          insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
          values (v_event.student_id, p_event_id, v_friday, 'scheduled', v_event.is_demo);
          v_n := 1;
        end if;
        v_added := v_added + v_n;
      end if;
    else
      update detentions set status = 'cancelled'
      where behaviour_event_id = p_event_id and status = 'scheduled';
      get diagnostics v_n = row_count;
      v_cancelled := v_cancelled + v_n;
    end if;

    select coalesce(sum(points), 0) into v_week_total
    from behaviour_events
    where student_id = v_event.student_id and type = 'negative' and voided_at is null
      and event_date between v_week_start and v_friday;

    if v_week_total <= r.detention_weekly_total_points then
      if v_friday >= v_today then
        update detentions set status = 'scheduled'
        where student_id = v_event.student_id and detention_date = v_friday
          and behaviour_event_id is null and status = 'cancelled';
        get diagnostics v_n = row_count;
        if v_n = 0 and not exists (
          select 1 from detentions
          where student_id = v_event.student_id and detention_date = v_friday and behaviour_event_id is null
        ) then
          insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
          values (v_event.student_id, null, v_friday, 'scheduled', v_event.is_demo);
          v_n := 1;
        end if;
        v_added := v_added + v_n;
      end if;
    else
      update detentions set status = 'cancelled'
      where student_id = v_event.student_id and detention_date = v_friday
        and behaviour_event_id is null and status = 'scheduled';
      get diagnostics v_n = row_count;
      v_cancelled := v_cancelled + v_n;
    end if;
  end if;

  return jsonb_build_object(
    'changed', true,
    'points', v_points,
    'detention_date', v_friday,
    'detentions_added', v_added,
    'detentions_cancelled', v_cancelled
  );
end;
$$;

-- The Lookups page from migration 262 calls the five-argument version; keep
-- it working (leaving the serious-event threshold as it is) until the page
-- that passes six arguments is deployed. (Applied as 263b.)
create or replace function public.set_behaviour_rules(
  p_detention_single_event_points integer,
  p_detention_weekly_total_points integer,
  p_alert_weekly_total_points integer,
  p_detention_room text,
  p_detention_time text)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select set_behaviour_rules(p_detention_single_event_points, p_detention_weekly_total_points,
    p_alert_weekly_total_points, p_detention_room, p_detention_time,
    (select serious_event_points from behaviour_rules where id));
$$;
