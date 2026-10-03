-- Migration 337: a Stage 5 returned to the teacher stops counting at once,
-- and every return is counted against the teacher.
--
-- Why (the principal, 3 Oct 2026, after returning four events): returning
-- an event (migration 335) only sent the teacher a note; the -5 and its
-- detention stayed until the teacher regraded it. The principal chose:
--   * the -5 is removed as soon as the event is returned (points 0, the
--     category kept, as an upheld appeal does), until the teacher regrades
--     it; the new category's points then count;
--   * its detention is cancelled if it hasn't happened yet (scheduled, dated
--     today or later; the student is told by the existing cancellation
--     notice), and the weekly-total detention too if the week no longer
--     reaches the threshold; detentions already attended stay;
--   * each return is recorded against the teacher who logged the event, in
--     behaviour_event_returns, so SMT can see who needs more training. It is
--     kept even after the event is regraded or deleted.
--
-- Also:
--   * set_behaviour_event_points_from_category() accepted only 0 as a
--     changed points value with the same category; it now also accepts the
--     category's own points, so a teacher who keeps a returned event as
--     Stage 5 (0 -> -5 through edit_behaviour_event()) isn't refused.
--   * The four events returned before this migration are brought into line:
--     points 0 and a row each in behaviour_event_returns. Their detentions
--     (Friday 2 Oct) are left as they are: three were attended and one is
--     past.

set local formwork.change_note = 'Principal (direct)';

-- --------------------------------------------------------- the tally

create table public.behaviour_event_returns (
  id bigint generated always as identity primary key,
  event_id integer references public.behaviour_events(event_id) on delete set null,
  student_id integer not null references public.students(student_id),
  teacher_staff_id integer references public.staff(staff_id),
  returned_by integer references public.staff(staff_id),
  returned_at timestamptz not null default now(),
  category text,
  points integer,
  note text not null
);

comment on table public.behaviour_event_returns is
  'Each Stage 5 returned to the teacher at /behaviour/review (migration 337), kept permanently and counted per teacher. Written only by return_behaviour_event_to_teacher(); read by SMT and admins.';

alter table public.behaviour_event_returns enable row level security;
grant select on public.behaviour_event_returns to authenticated;

create policy smt_read_behaviour_event_returns on public.behaviour_event_returns
  for select to authenticated
  using ((select is_admin()) or (select has_staff_role(array['smt'])));

-- ------------------------------------------- points stay the category's

create or replace function public.set_behaviour_event_points_from_category()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_points integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.category is not distinct from old.category
     and new.type is not distinct from old.type then
    if new.points is distinct from old.points and new.points is distinct from 0 then
      -- Migration 337: a returned event (points 0) going back to its
      -- category's points is allowed; any other number is not.
      select default_points into v_points
      from behaviour_categories
      where name = new.category and type = new.type;
      if new.points is distinct from v_points then
        raise exception 'Behaviour points are set by the category and cannot be changed';
      end if;
    end if;
    return new;
  end if;

  select default_points into v_points
  from behaviour_categories
  where name = new.category and type = new.type;

  if v_points is null then
    raise exception 'Choose a % behaviour category — points are set by the category', new.type;
  end if;

  new.points := v_points;
  return new;
end;
$function$;

-- ------------------------------------------------ returning an event

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
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_week_start date;
  v_week_total integer;
  v_cancelled integer;
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;
  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;

  -- The same reviewers as review_behaviour_for_parents() (migration 336).
  if v_event.photo_id is not null then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office', 'smt'])) then
    raise exception 'Only the school office, SMT or admin can review a behaviour event'
      using errcode = 'insufficient_privilege';
  end if;

  if v_event.voided_at is not null then
    raise exception 'This event has been withdrawn.';
  end if;
  if v_event.returned_at is not null then
    raise exception 'This event has already been returned to the teacher.';
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

  -- The -5 stops counting until the teacher regrades the event.
  update behaviour_events
  set returned_at = now(), returned_by = v_reviewer, return_note = v_note, points = 0
  where event_id = p_event_id;

  insert into behaviour_event_returns (event_id, student_id, teacher_staff_id, returned_by, category, points, note)
  values (p_event_id, v_event.student_id, v_event.staff_id, v_reviewer, v_event.category, v_event.points, v_note);

  -- Its detention, and the week's total detention if no longer reached,
  -- when they haven't happened yet.
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
      || '<p>Its points no longer count'
      || case when v_cancelled > 0 then ' and its detention has been cancelled' else '' end
      || '. If it isn''t a Stage 5, use Edit on the event to choose the right category; that category''s points will count. '
      || 'If it is, edit the explanation and it goes back for review.</p>'
      || '<p>Student record: https://misform.work/students/' || v_event.student_id || '</p>',
    'behaviour_returned');

  return jsonb_build_object('notified', coalesce(cardinality(v_logger), 0) > 0, 'detentions_cancelled', v_cancelled);
end;
$$;

revoke execute on function public.return_behaviour_event_to_teacher(integer, text) from public, anon;
grant execute on function public.return_behaviour_event_to_teacher(integer, text) to authenticated;

-- ------------------------------------- the four returned before this

insert into behaviour_event_returns (event_id, student_id, teacher_staff_id, returned_by, returned_at, category, points, note)
select event_id, student_id, staff_id, returned_by, returned_at, category, points, return_note
from behaviour_events
where returned_at is not null and points <> 0;

update behaviour_events set points = 0
where returned_at is not null and points <> 0;
