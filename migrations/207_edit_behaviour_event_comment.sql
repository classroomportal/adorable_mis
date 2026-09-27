-- Let staff correct what they wrote on a behaviour event, with a history.
--
-- A teacher who logged "Disruptive in class." and then wanted to give the
-- full account had no way to add it, so they logged the incident a second
-- time with the longer comment. The student got two Stage 5 events for one
-- incident, and with them a second detention and a weekly-total detention.
--
-- edit_behaviour_event_comment() changes the comment (description) and
-- nothing else. The person who logged the event can edit it, as can
-- pastoral, houseparents, SMT and admin (is_pastoral_or_smt()). Category and
-- points stay fixed: detentions, alerts and emails have already been
-- triggered from them on insert, and changing them here would leave those
-- out of step.
--
-- Every edit writes the old and new comment to behaviour_event_audit. That
-- table was set up for this and never used; it has no policies, so only
-- this SECURITY DEFINER function writes to it.

create or replace function public.edit_behaviour_event_comment(p_event_id integer, p_description text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event behaviour_events%rowtype;
  v_my_staff_id integer;
  v_new text := nullif(btrim(p_description), '');
begin
  select * into v_event from behaviour_events where event_id = p_event_id;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;

  select staff_id into v_my_staff_id from profiles where id = auth.uid();
  if not (is_pastoral_or_smt()
          or (v_my_staff_id is not null and v_my_staff_id = v_event.staff_id)) then
    raise exception 'Only the member of staff who logged this event, or pastoral/SMT, can edit it.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_new is not distinct from v_event.description then
    return;
  end if;

  update behaviour_events set description = v_new where event_id = p_event_id;

  insert into behaviour_event_audit (event_id, changed_by, old_values, new_values)
  values (p_event_id, auth.uid(),
          jsonb_build_object('description', v_event.description),
          jsonb_build_object('description', v_new));
end;
$$;

revoke all on function public.edit_behaviour_event_comment(integer, text) from public, anon;
grant execute on function public.edit_behaviour_event_comment(integer, text) to authenticated;
