-- 106_serious_behaviour_review.sql
-- A negative behaviour event of -4 or -5 points is "serious": the staff member
-- must write an explanation of what happened (no other student named, plain
-- good English, following school protocol), and a school-office reviewer must
-- check it before the event is shown to parents. Every other event stays
-- invisible to parents by default too (matches the earlier "don't inform
-- parents on any negative event by default" decision) — positive events are
-- the one exception, since there's nothing there to review.

alter table behaviour_events
  add column if not exists visible_to_parents boolean not null default false,
  add column if not exists protocol_reviewed_by integer references staff(staff_id),
  add column if not exists protocol_reviewed_at timestamptz;

-- Backfill: positive events were always shown to parents before this column
-- existed — keep that so the parent portal doesn't regress.
update behaviour_events set visible_to_parents = true where type = 'positive';

-- New positive events should default to visible too; a plain column DEFAULT
-- can't be conditional on another column, so a trigger does it.
create or replace function set_behaviour_event_default_visibility()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'positive' and new.visible_to_parents is not true then
    new.visible_to_parents := true;
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_event_default_visibility on behaviour_events;
create trigger behaviour_event_default_visibility
  before insert on behaviour_events
  for each row execute function set_behaviour_event_default_visibility();

-- A serious event can't be saved without an explanation in the first place.
alter table behaviour_events drop constraint if exists behaviour_events_serious_needs_description;
alter table behaviour_events
  add constraint behaviour_events_serious_needs_description
  check (
    not (type = 'negative' and points <= -4)
    or (description is not null and length(trim(description)) > 0)
  );

-- Parents only ever see events flagged visible_to_parents: positive events,
-- or a serious negative event a school-office reviewer has explicitly released.
drop policy if exists parent_read_own_behaviour on behaviour_events;
create policy parent_read_own_behaviour on behaviour_events
  for select
  using (
    visible_to_parents
    and exists (
      select 1 from profiles p
      join student_parent sp on sp.parent_id = p.parent_id
      where p.id = auth.uid() and sp.student_id = behaviour_events.student_id
    )
  );

-- Releasing a serious event to parents is a deliberate, audited act, not a
-- generic field edit — so it goes through this function rather than a normal
-- UPDATE grant. Only school office (or admin) can call it, and it refuses to
-- set visible_to_parents unless the caller confirms they checked protocol.
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

  if v_event.type <> 'negative' or v_event.points > -4 then
    raise exception 'Only serious (negative, -4 or -5 point) events go through this review';
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

revoke execute on function review_serious_behaviour_event(integer, boolean, boolean) from public;
revoke execute on function review_serious_behaviour_event(integer, boolean, boolean) from anon;
grant execute on function review_serious_behaviour_event(integer, boolean, boolean) to authenticated;
