-- Migration 376: behaviour reviewers can look through every event and change
-- its category, with a note to the teacher who logged it.
--
-- Why (the principal, 5 Oct 2026): Behaviour Review only showed Stage 5s and
-- events with a picture, so a reviewer who spotted a wrong category anywhere
-- else (a -2 that should be a -1, a positive under the wrong heading) had no
-- way to correct it and tell the teacher. Returning (migrations 335 and 337)
-- only covers Stage 5s and leaves the change to the teacher.
--
-- Now, at Behaviour Review's "All events" tab, a reviewer can change any
-- event's category (within its type: negative stays negative) and must say
-- why. recategorise_behaviour_event():
--   * allows only the reviewers: admin, or SMT / school office holding the
--     /behaviour/review page (the other office staff don't hold it,
--     migration 336);
--   * makes the change through edit_behaviour_event(), so points come from
--     the new category and detentions are added or cancelled exactly as for
--     any edit, the comment is unchanged, a return is cleared, and the
--     change is in behaviour_event_audit and change_history ('behaviour');
--   * keeps each change permanently in behaviour_category_changes (old and
--     new category and points, the note, who and when), read by the
--     reviewers;
--   * posts the note to the inbox of the teacher who logged the event
--     (kind 'behaviour_recategorised'), unless the reviewer logged it.
-- The comment itself is still edited with the existing Edit button.

set local formwork.change_note = 'Principal (direct)';

-- ------------------------------------------------------------ the record

create table public.behaviour_category_changes (
  id bigint generated always as identity primary key,
  event_id integer references public.behaviour_events(event_id) on delete set null,
  student_id integer not null references public.students(student_id),
  teacher_staff_id integer references public.staff(staff_id),
  changed_by integer references public.staff(staff_id),
  changed_at timestamptz not null default now(),
  old_category text,
  old_points integer,
  new_category text not null,
  new_points integer,
  note text not null
);

comment on table public.behaviour_category_changes is
  'Each behaviour category changed by a reviewer at /behaviour/review (migration 376), with the note sent to the teacher. Written only by recategorise_behaviour_event(); kept permanently; read by the reviewers.';

create index behaviour_category_changes_event_idx on public.behaviour_category_changes (event_id);

alter table public.behaviour_category_changes enable row level security;
grant select on public.behaviour_category_changes to authenticated;

create or replace function public.is_behaviour_reviewer()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select is_admin()
      or (has_staff_role(array['school_office', 'smt']) and has_resource_access('/behaviour/review'));
$$;

revoke execute on function public.is_behaviour_reviewer() from public, anon;
grant execute on function public.is_behaviour_reviewer() to authenticated;

create policy reviewers_read_behaviour_category_changes on public.behaviour_category_changes
  for select to authenticated
  using ((select is_behaviour_reviewer()));

-- ----------------------------------------------------- changing a category

create or replace function public.recategorise_behaviour_event(p_event_id integer, p_category text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event behaviour_events%rowtype;
  v_category text := nullif(btrim(p_category), '');
  v_note text := nullif(btrim(p_note), '');
  v_points integer;
  v_reviewer integer;
  v_student text;
  v_logger uuid[];
  v_result jsonb;
begin
  if not is_behaviour_reviewer() then
    raise exception 'Only behaviour reviewers (SMT, the school office reviewer or admin) can change a category here.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;
  if v_event.voided_at is not null then
    raise exception 'This event has been withdrawn.';
  end if;
  if v_category is null then
    raise exception 'Choose the new category.';
  end if;
  if v_category is not distinct from v_event.category then
    raise exception 'That is already the event''s category.';
  end if;
  if v_note is null then
    raise exception 'Say why the category is being changed, so the teacher knows.';
  end if;

  select default_points into v_points
  from behaviour_categories where name = v_category and type = v_event.type;
  if v_points is null then
    raise exception 'Choose a % behaviour category.', v_event.type;
  end if;

  -- Points, detentions, the audit and clearing a return, as for any edit.
  v_result := edit_behaviour_event(p_event_id, v_category, v_event.description);

  select staff_id into v_reviewer from profiles where id = auth.uid();

  insert into behaviour_category_changes
    (event_id, student_id, teacher_staff_id, changed_by, old_category, old_points, new_category, new_points, note)
  values
    (p_event_id, v_event.student_id, v_event.staff_id, v_reviewer, v_event.category, v_event.points, v_category, v_points, v_note);

  if v_event.staff_id is distinct from v_reviewer then
    select first_name || ' ' || last_name into v_student from students where student_id = v_event.student_id;
    select array_agg(id) into v_logger from profiles where staff_id = v_event.staff_id;

    perform post_inbox_notice(
      v_logger,
      'Behaviour category changed: ' || v_student,
      '<p>The ' || coalesce(v_event.category, v_event.type) || ' event ('
        || case when v_event.points > 0 then '+' else '' end || v_event.points || ') you logged for <strong>'
        || v_student || '</strong> on ' || to_char(v_event.event_date, 'DD/MM/YYYY') || ' has been changed to '
        || v_category || ' (' || case when v_points > 0 then '+' else '' end || v_points || ') by '
        || coalesce((select first_name || ' ' || last_name from staff where staff_id = v_reviewer), 'the reviewer')
        || '.</p>'
        || '<p>' || v_note || '</p>'
        || case when coalesce((v_result ->> 'detentions_added')::int, 0) > 0 then '<p>A detention has been added to match.</p>'
                when coalesce((v_result ->> 'detentions_cancelled')::int, 0) > 0 then '<p>Its detention has been cancelled to match.</p>'
                else '' end
        || '<p>Student record: https://misform.work/students/' || v_event.student_id || '</p>',
      'behaviour_recategorised');
  end if;

  return v_result || jsonb_build_object(
    'notified', v_event.staff_id is distinct from v_reviewer and coalesce(cardinality(v_logger), 0) > 0,
    'own_event', v_event.staff_id is not distinct from v_reviewer);
end;
$$;

revoke execute on function public.recategorise_behaviour_event(integer, text, text) from public, anon;
grant execute on function public.recategorise_behaviour_event(integer, text, text) to authenticated;
