-- Migration 387: any behaviour event with writing in it is approved before
-- it goes home.
--
-- Why (the principal, 7 Oct 2026): "Any event, negative or positive, that
-- has writing in it must have approval before going home." Until now only
-- Stage 5 (serious) events were checked. A merit went to parents the moment
-- it was logged, comment and all (300-430 merits with a comment a day), and
-- a Stage 1-4 event never went home at all.
--
-- The principal's choices:
--   * the whole event waits, points included, until it's approved (as Stage 5
--     does); a merit with no writing still goes home at once;
--   * Stage 1-4 events with writing now go home once approved (before, never);
--     without writing they still stay at school;
--   * the approvers are Stage 5's: the school office and SMT at
--     /behaviour/review (SMT for an event with a picture), through
--     review_behaviour_for_parents(), which now takes several hundred events
--     in one call for the page's "send selected".
--
-- What changes:
--   1. set_behaviour_event_default_visibility(): a new positive event is shown
--      to parents only if it has no writing.
--   2. behaviour_event_a_text_needs_review (new, BEFORE UPDATE OF description,
--      named to run before behaviour_event_no_other_names_for_parents and the
--      release guard): changing an event's writing takes it away from parents
--      and clears its review, so the new words are approved too, whoever
--      edits it. Writing removed: the event keeps what it had, except that a
--      merit not yet reviewed goes home like any merit without writing.
--   3. behaviour_event_release_guard(): the app can't log an event with
--      writing as already reviewed, and a writing change may move the
--      visibility (only ever as trigger 2 sets it).
--   4. review_behaviour_for_parents(): sends or keeps back any event with
--      writing, not only Stage 5 and pictures.
-- Events already with parents stay with them; this applies from now on.
-- Students still see their own events as before.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.behaviour_has_writing(p_text text)
returns boolean
language sql
immutable
as $$
  select nullif(btrim(coalesce(p_text, ''), E' \t\r\n\u00a0'), '') is not null;
$$;

-- 1. New events.
create or replace function public.set_behaviour_event_default_visibility()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- Migration 387: a merit with writing waits for the review.
  if new.type = 'positive' then
    new.visible_to_parents := not behaviour_has_writing(new.description);
  end if;
  return new;
end;
$function$;

-- 2. Edited writing goes back for approval.
create or replace function public.behaviour_event_text_needs_review()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.description is not distinct from old.description then
    return new;
  end if;

  if behaviour_has_writing(new.description) then
    new.visible_to_parents := false;
    new.protocol_reviewed_by := null;
    new.protocol_reviewed_at := null;
  else
    new.visible_to_parents := old.visible_to_parents
      or (new.type = 'positive' and old.protocol_reviewed_at is null);
    new.protocol_reviewed_by := old.protocol_reviewed_by;
    new.protocol_reviewed_at := old.protocol_reviewed_at;
  end if;
  return new;
end;
$function$;

revoke execute on function public.behaviour_event_text_needs_review() from public, anon, authenticated;

create trigger behaviour_event_a_text_needs_review
  before update of description on public.behaviour_events
  for each row execute function public.behaviour_event_text_needs_review();

-- 3. The guard.
create or replace function public.behaviour_event_release_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- The review and edit functions run as their owner, and the SQL editor as
  -- postgres; only requests from the app arrive as 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.type = 'negative'
       and (new.visible_to_parents or new.protocol_reviewed_by is not null or new.protocol_reviewed_at is not null) then
      raise exception 'A negative behaviour event starts hidden from parents; it is released through the review.'
        using errcode = 'insufficient_privilege';
    end if;
    -- Migration 387: writing is approved before it goes home.
    if behaviour_has_writing(new.description)
       and (new.visible_to_parents or new.protocol_reviewed_by is not null or new.protocol_reviewed_at is not null) then
      raise exception 'A behaviour event with writing starts hidden from parents; it is released through the review.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.voided_at is not null or new.voided_points is not null then
      raise exception 'A behaviour event can''t be logged as withdrawn.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.returned_at is not null or new.returned_by is not null or new.return_note is not null then
      raise exception 'A behaviour event can''t be logged as returned to the teacher.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Migration 387: when the writing changes, behaviour_event_a_text_needs_review
  -- has already set who sees it, from the old row, not the request.
  if (new.description is not distinct from old.description
      and (new.visible_to_parents is distinct from old.visible_to_parents
           or new.protocol_reviewed_by is distinct from old.protocol_reviewed_by
           or new.protocol_reviewed_at is distinct from old.protocol_reviewed_at))
     or new.type is distinct from old.type then
    raise exception 'Whether parents see a behaviour event is decided through the review at /behaviour/review, and an event''s type can''t be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Migration 319: removing an event is SMT's (delete), or an upheld appeal's.
  if new.voided_at is distinct from old.voided_at
     or new.voided_points is distinct from old.voided_points
     or new.student_id is distinct from old.student_id then
    raise exception 'A behaviour event can''t be withdrawn or moved to another student here. Only SMT can remove one.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Migration 335: returning an event is the reviewer's, through the review.
  if new.returned_at is distinct from old.returned_at
     or new.returned_by is distinct from old.returned_by
     or new.return_note is distinct from old.return_note then
    raise exception 'An event is returned to the teacher only from Behaviour Review.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$function$;

-- 4. The review.
create or replace function public.review_behaviour_for_parents(p_event_ids integer[], p_send_text boolean, p_send_picture boolean, p_protocol_confirmed boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  elsif not (is_admin() or has_staff_role(array['school_office', 'smt'])) then
    raise exception 'Only the school office, SMT or admin can send a behaviour event to parents'
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

  -- Migration 387: any event with writing can be sent, as well as Stage 5
  -- and events with a picture. A Stage 1-4 event without writing still
  -- stays at school.
  if p_send_text and exists (
    select 1 from behaviour_events
    where event_id = any(p_event_ids)
      and type = 'negative' and points > r.serious_event_points and photo_id is null
      and not behaviour_has_writing(description)
  ) then
    raise exception 'Only serious (% point) events, events with writing, or events with a picture, can be sent to parents from the review', r.serious_event_points;
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
      and (type = 'negative' or behaviour_has_writing(description));
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
$function$;
