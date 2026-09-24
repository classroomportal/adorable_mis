-- 166_serious_behaviour_only_minus_5.sql
-- The school has settled what "serious" means: only a -5 negative event.
-- A -3 or -4 is not serious and does not earn a detention on its own.
--
-- Migration 135 had moved "serious" to -3 (written explanation + school-office
-- review before parents see it), and 165 then moved the automatic single-event
-- detention to -3 to match. Both are set to -5 here, in every place the
-- database enforces it:
--   - behaviour_events_serious_needs_description (explanation required)
--   - review_serious_behaviour_event() (which events go through review)
--   - handle_negative_behaviour() (automatic single-event detention; this is
--     where it stood before 165)
--
-- A -3/-4 now behaves like a -1/-2: hidden from parents (visible_to_parents
-- defaults false for negatives), no review, and it still counts towards the
-- 10-point weekly-total detention, which is unchanged. Not touched: the
-- SMT/houseparent email alert in notify_pastoral_on_negative_behaviour(),
-- which fires at -4 as its own policy.
--
-- Clean-up: detentions tied to a single event better than -5 are removed while
-- still 'scheduled' — at the time of writing, the five -3 detentions 165
-- backfilled for Friday 25 September 2026. Weekly-total detentions
-- (behaviour_event_id null) are untouched. -3/-4 events already reviewed and
-- released to parents keep that state.

alter table behaviour_events drop constraint if exists behaviour_events_serious_needs_description;
alter table behaviour_events
  add constraint behaviour_events_serious_needs_description
  check (
    not (type = 'negative' and points <= -5)
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

  if v_event.type <> 'negative' or v_event.points > -5 then
    raise exception 'Only serious (negative, -5 point) events go through this review';
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

create or replace function handle_negative_behaviour()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  week_start date;
  week_end date;
  week_total integer;
  detention_friday date;
begin
  if new.points <= -3 then
    perform pg_notify('behaviour_escalation', json_build_object(
      'event_id', new.event_id,
      'student_id', new.student_id,
      'points', new.points
    )::text);
  end if;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;
  detention_friday := week_start + 6;

  if new.points <= -5 then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, new.event_id, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions where behaviour_event_id = new.event_id
    );
  end if;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if week_total <= -10 then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, null, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions
      where student_id = new.student_id and detention_date = detention_friday and behaviour_event_id is null
    );
  end if;

  return new;
end;
$$;

delete from detentions d
using behaviour_events be
where be.event_id = d.behaviour_event_id
  and be.points > -5
  and d.status = 'scheduled';
