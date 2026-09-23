-- 135_serious_behaviour_threshold_minus_3.sql
-- The school wants a written explanation, checked before parents see it, for
-- every negative event of -3 or worse — not just -4/-5 as migration 106 set
-- up. This moves that "serious" threshold from -4 to -3 in the two places the
-- database enforces it: the must-have-a-description check constraint and the
-- review_serious_behaviour_event() guard.
--
-- Deliberately NOT changed: the SMT/houseparent email alert and the automatic
-- single-event detention still fire at -4. Those are separate policies; the
-- ask here was only about the written comment and its review.
--
-- Checked against live data before writing this: there were no negative events
-- at -3 or below, so no existing row violates the tightened constraint.

alter table behaviour_events drop constraint if exists behaviour_events_serious_needs_description;
alter table behaviour_events
  add constraint behaviour_events_serious_needs_description
  check (
    not (type = 'negative' and points <= -3)
    or (description is not null and length(trim(description)) > 0)
  );

create or replace function review_serious_behaviour_event(
  p_event_id integer,
  p_visible_to_parents boolean,
  p_protocol_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event behaviour_events%rowtype;
  v_reviewer_staff_id integer;
begin
  if not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can review a behaviour event';
  end if;

  select * into v_event from behaviour_events where event_id = p_event_id;
  if not found then
    raise exception 'Behaviour event % not found', p_event_id;
  end if;

  if v_event.type <> 'negative' or v_event.points > -3 then
    raise exception 'Only serious (negative, -3 to -5 point) events go through this review';
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
