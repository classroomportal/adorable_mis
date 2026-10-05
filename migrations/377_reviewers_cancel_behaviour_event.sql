-- Migration 377: behaviour reviewers can cancel a wrongly logged event,
-- with a note to the teacher who logged it.
--
-- Why (the principal, 5 Oct 2026, with migration 376): looking through
-- every event at Behaviour Review, a reviewer also finds events that should
-- never have been logged at all (the wrong student, a duplicate, nothing
-- that warranted it). Changing the category doesn't fix those, and until
-- now only SMT could remove one, by deleting it (migration 319), which
-- leaves no trace on the student's record and tells nobody.
--
-- cancel_behaviour_event():
--   * allows only the reviewers (is_behaviour_reviewer(), migration 376);
--   * withdraws the event the way an upheld appeal does (void_event_on_
--     upheld_appeal()): voided_at set, its points kept in voided_points and
--     set to 0, so it stops counting everywhere (totals, detentions, reward
--     points, portals) but stays on the student's record, crossed out;
--   * cancels its detention, and the week's total detention if the week no
--     longer reaches the threshold, when they haven't happened yet (as a
--     return does, migration 337); the student is told by the existing
--     cancellation notice;
--   * keeps the reason permanently in behaviour_event_cancellations (read by
--     all staff, like the event itself, so the student's profile can say
--     who cancelled it and why);
--   * posts the reason to the inbox of the teacher who logged the event,
--     unless the reviewer logged it.
-- A cancelled event can't be edited, changed or cancelled again; the app
-- still can't set voided_at itself (behaviour_event_release_guard()).

set local formwork.change_note = 'Principal (direct)';

create table public.behaviour_event_cancellations (
  id bigint generated always as identity primary key,
  event_id integer references public.behaviour_events(event_id) on delete set null,
  student_id integer not null references public.students(student_id),
  teacher_staff_id integer references public.staff(staff_id),
  cancelled_by integer references public.staff(staff_id),
  cancelled_at timestamptz not null default now(),
  category text,
  points integer,
  note text not null
);

comment on table public.behaviour_event_cancellations is
  'Each behaviour event cancelled by a reviewer at /behaviour/review (migration 377), with the reason sent to the teacher. Written only by cancel_behaviour_event(); kept permanently; read by staff.';

create index behaviour_event_cancellations_event_idx on public.behaviour_event_cancellations (event_id);

alter table public.behaviour_event_cancellations enable row level security;
grant select on public.behaviour_event_cancellations to authenticated;

create policy staff_read_behaviour_event_cancellations on public.behaviour_event_cancellations
  for select to authenticated
  using ((select is_staff_or_admin()));

create or replace function public.cancel_behaviour_event(p_event_id integer, p_note text)
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
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_week_start date;
  v_week_total integer;
  v_cancelled integer := 0;
  r behaviour_rules;
begin
  if not is_behaviour_reviewer() then
    raise exception 'Only behaviour reviewers (SMT, the school office reviewer or admin) can cancel an event.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into r from behaviour_rules where id;
  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;
  if v_event.voided_at is not null then
    raise exception 'This event has already been withdrawn.';
  end if;
  if v_note is null then
    raise exception 'Say why the event is being cancelled, so the teacher knows.';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  update behaviour_events
  set voided_points = points, points = 0, voided_at = now()
  where event_id = p_event_id;

  insert into behaviour_event_cancellations (event_id, student_id, teacher_staff_id, cancelled_by, category, points, note)
  values (p_event_id, v_event.student_id, v_event.staff_id, v_reviewer, v_event.category, v_event.points, v_note);

  if v_event.type = 'negative' then
    v_week_start := v_event.event_date - ((extract(dow from v_event.event_date)::int - 6 + 7) % 7);
    select coalesce(sum(points), 0) into v_week_total
    from behaviour_events
    where student_id = v_event.student_id and type = 'negative' and voided_at is null
      and event_date between v_week_start and v_week_start + 6;

    update detentions set status = 'cancelled'
    where status = 'scheduled'
      and detention_date >= v_today
      and (behaviour_event_id = p_event_id
           or (v_week_total > r.detention_weekly_total_points
               and student_id = v_event.student_id
               and detention_date = v_week_start + 6
               and behaviour_event_id is null));
    get diagnostics v_cancelled = row_count;
  end if;

  if v_event.staff_id is distinct from v_reviewer then
    select first_name || ' ' || last_name into v_student from students where student_id = v_event.student_id;
    select array_agg(id) into v_logger from profiles where staff_id = v_event.staff_id;

    perform post_inbox_notice(
      v_logger,
      'Behaviour event cancelled: ' || v_student,
      '<p>The ' || coalesce(v_event.category, v_event.type) || ' event ('
        || case when v_event.points > 0 then '+' else '' end || v_event.points || ') you logged for <strong>'
        || v_student || '</strong> on ' || to_char(v_event.event_date, 'DD/MM/YYYY') || ' has been cancelled by '
        || coalesce((select first_name || ' ' || last_name from staff where staff_id = v_reviewer), 'the reviewer')
        || '. Its points no longer count'
        || case when v_cancelled > 0 then ' and its detention has been cancelled' else '' end
        || '.</p>'
        || '<p>' || v_note || '</p>'
        || '<p>Student record: https://misform.work/students/' || v_event.student_id || '</p>',
      'behaviour_cancelled');
  end if;

  return jsonb_build_object(
    'detentions_cancelled', v_cancelled,
    'notified', v_event.staff_id is distinct from v_reviewer and coalesce(cardinality(v_logger), 0) > 0,
    'own_event', v_event.staff_id is not distinct from v_reviewer);
end;
$$;

revoke execute on function public.cancel_behaviour_event(integer, text) from public, anon;
grant execute on function public.cancel_behaviour_event(integer, text) to authenticated;
