-- 238_send_behaviour_text_and_picture_separately.sql
-- On /behaviour/review the school office decides a behaviour event's text and
-- its picture separately: send the text with the picture, send the text
-- without it, or edit the text first and then send.
--
-- Until now only a -5 event's text could be sent to parents
-- (review_serious_behaviour_event); a -1 to -4 event was never shown to them
-- (migration 166), so its picture could be approved but no parent could ever
-- see it (parents only see a picture on an event they can see, migration
-- 209). The office asked to be able to send those too once a member of staff
-- has added a picture. So an event with a picture can now be sent to parents
-- whatever its points, but only by school office or admin, from the review
-- page, after ticking the same protocol confirmation as a -5 event. A -1 to
-- -4 event without a picture still never reaches parents.
--
-- review_behaviour_for_parents() takes a set of events (a picture logged for
-- a group links several) and decides both at once:
--   p_send_text     true  -> the events' text is shown to parents
--                   false -> kept from them
--                   null  -> left as it is (a positive event, already shown)
--   p_send_picture  true/false -> the picture is approved/declined
--                   null  -> left as it is (no picture, or already decided)
-- Positive events are always visible (set_behaviour_event_default_visibility),
-- so p_send_text only ever changes negative events. The two older functions
-- stay for anything still calling them.

create or replace function public.review_behaviour_for_parents(
  p_event_ids integer[],
  p_send_text boolean,
  p_send_picture boolean,
  p_protocol_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reviewer integer;
  v_found integer;
begin
  if not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can send a behaviour event to parents'
      using errcode = 'insufficient_privilege';
  end if;

  if p_event_ids is null or cardinality(p_event_ids) = 0 then
    raise exception 'No behaviour events given.';
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
      and type = 'negative' and points > -5 and photo_id is null
  ) then
    raise exception 'Only -5 events, or events with a picture, can be sent to parents from the review';
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

revoke all on function public.review_behaviour_for_parents(integer[], boolean, boolean, boolean) from public, anon;
grant execute on function public.review_behaviour_for_parents(integer[], boolean, boolean, boolean) to authenticated;
