-- Migration 378: a behaviour event keeps its points unless its category
-- changes, and categories are retired rather than removed.
--
-- Why (the principal, 5 Oct 2026): a logged event is a record of what
-- happened. Until now edit_behaviour_event() re-read the category's points on
-- every save, even when only the comment changed, so after a category's
-- points were changed at /admin/lookups the next edit of any old event quietly
-- re-priced it and added or cancelled detentions. And a category removed (or
-- renamed) at Lookups left its old events unable to be edited at all ("Choose
-- a negative behaviour category"), because their category no longer existed.
--
--   * edit_behaviour_event(): with the category unchanged the event keeps the
--     points it has; detentions are only recalculated when the points really
--     change. A returned Stage 5 (points 0, migration 337) kept as it is gets
--     back the points it had when it was returned (behaviour_event_returns),
--     not the category's points today. A new category must exist and not be
--     retired; its points apply.
--   * set_behaviour_event_points_from_category(): the same rule for any other
--     save: on an event whose category is unchanged, points may only stay, go
--     to 0, or go back to the points recorded when it was returned. A new
--     event, or a change of category, must use a category that isn't retired.
--   * behaviour_categories.retired: a retired category is left off the lists
--     used to log an event or change a category, but its old events keep it,
--     can be edited and filtered, and it can be brought back. Retiring is an
--     edit (the Edit tick at /admin/permissions; admins today).
--   * A category used by any event can't be deleted, renamed or have its type
--     changed (behaviour_category_in_use_guard()): retire it and add a new
--     one. Its points can still be changed; that applies to new events and
--     to events moved into it, never to events already logged.

set local formwork.change_note = 'Principal (direct)';

alter table public.behaviour_categories
  add column retired boolean not null default false;

comment on column public.behaviour_categories.retired is
  'Retired categories (migration 378) are not offered for new events or category changes; existing events keep them.';

-- ------------------------------------------- used categories stay put

create or replace function public.behaviour_category_in_use_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if (tg_op = 'DELETE'
      or new.name is distinct from old.name
      or new.type is distinct from old.type)
     and exists (select 1 from behaviour_events where category = old.name and type = old.type) then
    raise exception '"%" is used by behaviour events already logged, so it can''t be %. Retire it instead, and add a new category if needed.',
      old.name, case when tg_op = 'DELETE' then 'removed' else 'renamed or moved to the other type' end;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function public.behaviour_category_in_use_guard() from public, anon, authenticated;

create trigger behaviour_category_in_use_guard
  before update or delete on public.behaviour_categories
  for each row execute function public.behaviour_category_in_use_guard();

-- ------------------------------------------------ points stay the event's

create or replace function public.set_behaviour_event_points_from_category()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_points integer;
  v_retired boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.category is not distinct from old.category
     and new.type is not distinct from old.type then
    if new.points is distinct from old.points and new.points is distinct from 0 then
      -- Migration 378: points don't follow the category any more; the only
      -- change allowed (besides 0, for a return) is a returned event getting
      -- back the points it had when it was returned.
      if old.returned_at is null or new.points is distinct from (
           select points from behaviour_event_returns
           where event_id = new.event_id order by returned_at desc limit 1) then
        raise exception 'Behaviour points are set by the category and cannot be changed';
      end if;
    end if;
    return new;
  end if;

  select default_points, retired into v_points, v_retired
  from behaviour_categories
  where name = new.category and type = new.type;

  if v_points is null then
    raise exception 'Choose a % behaviour category — points are set by the category', new.type;
  end if;
  if v_retired then
    raise exception '"%" is a retired behaviour category. Choose another.', new.category;
  end if;

  new.points := v_points;
  return new;
end;
$function$;

-- ------------------------------------------------------- editing an event

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
  v_retired boolean;
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

  if v_category is not distinct from v_event.category then
    -- Same category: the event keeps its points (migration 378). A returned
    -- Stage 5 gets back the points it had when it was returned.
    if v_event.returned_at is not null then
      select points into v_points from behaviour_event_returns
      where event_id = p_event_id order by returned_at desc limit 1;
      if v_points is null then
        select default_points into v_points
        from behaviour_categories where name = v_category and type = v_event.type;
      end if;
    else
      v_points := v_event.points;
    end if;
    if v_points is null then
      raise exception 'Choose a % behaviour category.', v_event.type;
    end if;
  else
    select default_points, retired into v_points, v_retired
    from behaviour_categories where name = v_category and type = v_event.type;
    if v_points is null then
      raise exception 'Choose a % behaviour category.', v_event.type;
    end if;
    if v_retired then
      raise exception '"%" is a retired behaviour category. Choose another.', v_category;
    end if;
  end if;

  if v_points <= r.serious_event_points and v_description is null then
    raise exception 'A serious event (% points or worse) needs an explanation of what happened.', r.serious_event_points;
  end if;

  if v_category is not distinct from v_event.category
     and v_description is not distinct from v_event.description then
    return jsonb_build_object('changed', false, 'detentions_added', 0, 'detentions_cancelled', 0);
  end if;

  update behaviour_events
  set category = v_category, points = v_points, description = v_description,
      returned_at = null, returned_by = null, return_note = null
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
