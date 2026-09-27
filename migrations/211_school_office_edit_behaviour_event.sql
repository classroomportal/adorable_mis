-- The school office can edit a behaviour event, so they can fix a serious
-- event's explanation while reviewing it.
--
-- /behaviour/review is where school office check a -5 event's explanation
-- before parents see it. When it wasn't right, all they could do was "keep
-- hidden (needs rewriting)", and the event dropped out of their list with
-- nothing to rewrite it. The office now edits the explanation (and category)
-- in place and releases it. edit_behaviour_event() (migration 208) is
-- unchanged except that has_staff_role('school_office') joins the people
-- allowed to edit; every edit is still audited and detentions still follow
-- the points.

create or replace function public.edit_behaviour_event(
  p_event_id integer,
  p_category text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
begin
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
  if v_points <= -5 and v_description is null then
    raise exception 'A serious event (-5 points) needs an explanation of what happened.';
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

    -- This event's own detention.
    if v_points <= -5 then
      if v_friday >= v_today then
        -- Put back one cancelled by an earlier downgrade, else add one.
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

    -- The week's total detention.
    select coalesce(sum(points), 0) into v_week_total
    from behaviour_events
    where student_id = v_event.student_id and type = 'negative' and voided_at is null
      and event_date between v_week_start and v_friday;

    if v_week_total <= -10 then
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
