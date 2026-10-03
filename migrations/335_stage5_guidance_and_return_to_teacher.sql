-- Migration 335: help staff choose Stage 5 only for serious events, and let
-- the reviewer send a wrongly graded one back to the teacher.
--
-- Why (the principal, 3 Oct 2026): some staff are logging Stage 5 (-5,
-- the serious-event level) for minor offences. A Stage 5 needs an
-- explanation, gives a detention, goes to the school office's review and is
-- released to parents, so a wrong one costs the student and the office.
-- Staff are being trained; the app should prompt them too. The principal
-- chose:
--   1. a guidance box on the Log behaviour form when a serious category is
--      picked: what is and isn't Stage 5 (no drugs: there are none in the
--      school, and no weapons; violence of any kind is Stage 5; a phone is
--      Stage 5, as phones are allowed only on Sunday after lunch);
--   2. a confirmation tick before a serious event can be saved (page only);
--   3. a short description for each behaviour category, shown when it is
--      picked;
--   5. on Behaviour Review, "Not Stage 5: return to teacher", which sends
--      the teacher a note asking them to regrade it.
--
-- Changes:
--   * behaviour_rules.serious_event_guidance: the guidance text, seeded
--     below, edited at /admin/lookups through set_serious_event_guidance()
--     (Lookups holders, as set_behaviour_rules()). behaviour_rules is
--     already logged in change_history under behaviour.
--   * behaviour_categories.description: edited at /admin/lookups by whoever
--     can edit categories (the ability_edit tick). Seeded for the three -5
--     categories only; the school writes the rest.
--   * behaviour_events.returned_at / returned_by / return_note, set only by
--     return_behaviour_event_to_teacher() (the same reviewers as
--     review_behaviour_for_parents(): the school office, SMT for an event
--     with a picture, admin). It posts the note to the inbox of the staff
--     member who logged the event. edit_behaviour_event() clears them on
--     any real change: a downgraded event leaves the review, and one kept
--     at Stage 5 with a better explanation comes back to "Waiting".
--   * behaviour_event_release_guard() refuses returned_* from the app, as
--     it does the review columns.

set local formwork.change_note = 'Principal (direct)';

-- ------------------------------------------------------------ 1. guidance

alter table public.behaviour_rules
  add column if not exists serious_event_guidance text;

update public.behaviour_rules set serious_event_guidance =
'Stage 5 is for a single serious incident that parents need to know about, even if the student has never been in trouble before. Ask: did it put someone''s safety, wellbeing or property at risk, involve dishonesty, or seriously challenge a member of staff?

Usually Stage 5:
• Violence of any kind: fighting, hitting, pushing, kicking or throwing things at someone; threatening violence
• Bullying or harassment, in person or online; sexual, racist or tribal remarks; sharing pictures of others without their consent
• Theft; forging a signature or a note; cheating in a test or exam
• Leaving the campus without permission; being out of the boarding house at night; being in the other boarding house without permission
• Swearing at or abusing a member of staff; refusing an instruction where safety is at risk
• Deliberate damage to school property or someone else''s belongings
• Having or using a phone, except on Sunday after lunch
• Serious misuse of a laptop, such as inappropriate content or using someone else''s account

Not Stage 5:
• Talking, calling out or low-level disruption
• Late to a lesson or a meal, no equipment, homework not done
• Uniform
• Eating in class, sleeping in class
• A one-off rude remark to another student
• Repeated minor behaviour: log each incident at its own stage. The weekly total gives a detention automatically.'
where id and serious_event_guidance is null;

create or replace function public.set_serious_event_guidance(p_text text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change the Stage 5 guidance.';
  end if;
  update behaviour_rules set
    serious_event_guidance = nullif(btrim(p_text), ''),
    updated_by = auth.uid(),
    updated_at = now()
  where id;
end;
$$;

revoke execute on function public.set_serious_event_guidance(text) from public, anon;
grant execute on function public.set_serious_event_guidance(text) to authenticated;

-- ------------------------------------------------- 3. category descriptions

alter table public.behaviour_categories
  add column if not exists description text;

update public.behaviour_categories set description =
  'A single serious incident not covered by Bullying or Academic dishonesty: violence of any kind or threats of violence, theft, forgery, leaving the campus or the boarding house without permission, abuse of staff, deliberate damage, having or using a phone (except on Sunday after lunch), serious misuse of a laptop. Not for repeated minor behaviour.'
where name = 'Stage 5' and type = 'negative' and description is null;

update public.behaviour_categories set description =
  'Deliberately hurting, frightening or humiliating another student, usually more than once, in person or online, including harassment and sexual, racist or tribal remarks. A single falling-out between friends is not bullying.'
where name = 'Bullying' and type = 'negative' and description is null;

update public.behaviour_categories set description =
  'Cheating in a test or exam, copying work or handing in someone else''s work as their own, or helping someone else to cheat.'
where name = 'Academic dishonesty' and type = 'negative' and description is null;

-- --------------------------------------------------- 5. return to teacher

alter table public.behaviour_events
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by integer references public.staff(staff_id),
  add column if not exists return_note text;

create or replace function public.return_behaviour_event_to_teacher(p_event_id integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event behaviour_events%rowtype;
  v_note text := nullif(btrim(p_note), '');
  v_reviewer integer;
  v_student text;
  v_logger uuid[];
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;
  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;

  -- The same reviewers as review_behaviour_for_parents().
  if v_event.photo_id is not null then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can review a behaviour event'
      using errcode = 'insufficient_privilege';
  end if;

  if v_event.voided_at is not null then
    raise exception 'This event has been withdrawn.';
  end if;
  if v_event.type <> 'negative' or v_event.points > r.serious_event_points then
    raise exception 'Only serious (% point) events can be returned to the teacher.', r.serious_event_points;
  end if;
  if v_event.visible_to_parents then
    raise exception 'Parents can already see this event.';
  end if;
  if v_note is null then
    raise exception 'Say why it is being returned, so the teacher knows what to change.';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  update behaviour_events
  set returned_at = now(), returned_by = v_reviewer, return_note = v_note
  where event_id = p_event_id;

  select first_name || ' ' || last_name into v_student from students where student_id = v_event.student_id;
  select array_agg(id) into v_logger from profiles where staff_id = v_event.staff_id;

  perform post_inbox_notice(
    v_logger,
    'Please check this Stage 5: ' || v_student,
    '<p>The ' || coalesce(v_event.category, 'serious') || ' event you logged for <strong>' || v_student
      || '</strong> on ' || to_char(v_event.event_date, 'DD/MM/YYYY')
      || ' has been returned to you by '
      || coalesce((select first_name || ' ' || last_name from staff where staff_id = v_reviewer), 'the reviewer')
      || ' before it goes to parents.</p>'
      || '<p>' || v_note || '</p>'
      || '<p>If it isn''t a Stage 5, use Edit on the event to choose the right category. '
      || 'If it is, edit the explanation and it goes back for review.</p>'
      || '<p>Student record: https://misform.work/students/' || v_event.student_id || '</p>',
    'behaviour_returned');

  return jsonb_build_object('notified', coalesce(cardinality(v_logger), 0) > 0);
end;
$$;

revoke execute on function public.return_behaviour_event_to_teacher(integer, text) from public, anon;
grant execute on function public.return_behaviour_event_to_teacher(integer, text) to authenticated;

-- As migration 330, plus returned_* (set only by the function above and
-- cleared by edit_behaviour_event()).
create or replace function public.behaviour_event_release_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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

  if new.visible_to_parents is distinct from old.visible_to_parents
     or new.protocol_reviewed_by is distinct from old.protocol_reviewed_by
     or new.protocol_reviewed_at is distinct from old.protocol_reviewed_at
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
$$;
revoke execute on function public.behaviour_event_release_guard() from public, anon, authenticated;

-- As migration 263, except that a real change clears returned_*.
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
