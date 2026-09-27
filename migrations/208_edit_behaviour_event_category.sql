-- Let staff change a behaviour event's category as well as its comment, and
-- keep detentions in step with the new points.
--
-- 207 allowed the comment only, because a category sets the points and the
-- points have already decided detentions. Staff do pick the wrong stage, so
-- edit_behaviour_event() now takes a category too. It stays within the
-- event's type (a negative event can't be turned into a positive one), takes
-- the points from behaviour_categories as on insert, and then re-applies the
-- detention rules from handle_negative_behaviour() to the edited event:
--
--   * serious event (-5 or worse): a detention for this event on the Friday
--     of its week, added if it is now serious and has none, cancelled if it
--     no longer is;
--   * weekly total of -10 or worse (Saturday to Friday, ignoring events voided
--     by an upheld appeal): the week's total detention, added or cancelled the
--     same way.
--
-- Only 'scheduled' detentions are cancelled (one already attended or missed
-- is history). A detention is only added, or a cancelled one put back, while
-- its Friday is today or later in Lagos, so editing an old event doesn't
-- book a detention in the past.
-- Cancelling goes through the normal status update, so the student gets the
-- usual "detention cancelled" notice (migration 200); adding one gets the
-- usual detention notice (trg_notify_student_of_detention).
--
-- Who may edit is unchanged from 207: the member of staff who logged it, or
-- pastoral/houseparents/SMT/admin. Every edit is written to
-- behaviour_event_audit. edit_behaviour_event_comment() now calls this.

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
          or (v_my_staff_id is not null and v_my_staff_id = v_event.staff_id)) then
    raise exception 'Only the member of staff who logged this event, or pastoral/SMT, can edit it.'
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

revoke all on function public.edit_behaviour_event(integer, text, text) from public, anon;
grant execute on function public.edit_behaviour_event(integer, text, text) to authenticated;

-- Kept for any page still calling 207's name: a comment-only edit.
create or replace function public.edit_behaviour_event_comment(p_event_id integer, p_description text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform edit_behaviour_event(p_event_id, null, p_description);
end;
$$;
