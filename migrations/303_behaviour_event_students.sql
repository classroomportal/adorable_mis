-- Migration 303: record the other students in a serious (Stage 5) behaviour
-- event, as witness, involved or target.
--
-- Why (the principal, 1 Oct 2026): "Teachers need to be able to add students
-- involved in stage 5 events by witness, involved, or target - choosing the
-- extra student must be by a filter". Until now the only place to mention
-- another student was the explanation, and /behaviour tells staff not to
-- name other students there, because the explanation can be released to the
-- student's parents (migrations 106, 166, 238). So who else was there was
-- either left out or written where a parent might read it.
--
-- Now:
--   1. behaviour_event_students: one row per other student on an event, with
--      their part ('witness', 'involved' or 'target'). It applies to serious
--      events, the ones at or below behaviour_rules.serious_event_points
--      (-5 today: Stage 5, Bullying and Academic dishonesty), read from the
--      rule rather than hard-coded, so it follows /admin/lookups.
--   2. Staff only. All staff can read the links, as they can read the events.
--      Adding, changing and removing them is allowed to the same people who
--      can edit the event (edit_behaviour_event(), migration 211): the member
--      of staff who logged it, pastoral/SMT and the school office, through
--      can_edit_behaviour_event(). There is deliberately no student or parent
--      policy: a linked student is never shown on the portals, to the
--      student the event is about, to the linked student, or to any parent.
--   3. behaviour_event_students_check() refuses a link to an event that isn't
--      serious or was withdrawn on appeal, and a link to the event's own
--      student. added_by is stamped from auth.uid() by stamp_actor().
--   4. Every insert, change and removal is logged in change_history under
--      'behaviour'.
-- Linking a student gives them no points, detention or alert: those still
-- come only from an event logged for them.

set local formwork.change_note = 'Principal (direct)';

-- 1. Who may edit an event (the same rule as edit_behaviour_event()) -------------------

create or replace function public.can_edit_behaviour_event(p_event_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from behaviour_events e
    where e.event_id = p_event_id
      and (is_pastoral_or_smt()
           or has_staff_role(array['school_office'])
           or e.staff_id = (select p.staff_id from profiles p where p.id = auth.uid()))
  );
$$;

revoke execute on function public.can_edit_behaviour_event(integer) from public, anon;
grant execute on function public.can_edit_behaviour_event(integer) to authenticated;

-- 2. The table -----------------------------------------------------------------------------

create table public.behaviour_event_students (
  event_id integer not null references public.behaviour_events(event_id) on delete cascade,
  student_id integer not null references public.students(student_id),
  involvement text not null check (involvement in ('witness', 'involved', 'target')),
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (event_id, student_id)
);

create index behaviour_event_students_student_idx on public.behaviour_event_students (student_id);

alter table public.behaviour_event_students enable row level security;
grant select, insert, update, delete on public.behaviour_event_students to authenticated;

create policy staff_read_behaviour_event_students on public.behaviour_event_students
  for select using (is_staff_or_admin());

create policy editors_insert_behaviour_event_students on public.behaviour_event_students
  for insert with check (is_staff_or_admin() and can_edit_behaviour_event(event_id));

create policy editors_update_behaviour_event_students on public.behaviour_event_students
  for update using (is_staff_or_admin() and can_edit_behaviour_event(event_id))
  with check (is_staff_or_admin() and can_edit_behaviour_event(event_id));

create policy editors_delete_behaviour_event_students on public.behaviour_event_students
  for delete using (is_staff_or_admin() and can_edit_behaviour_event(event_id));

-- 3. Only serious, live events, and never the event's own student -----------------------

create or replace function public.behaviour_event_students_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event behaviour_events%rowtype;
  v_serious integer;
begin
  if tg_op = 'UPDATE' and (new.event_id <> old.event_id or new.student_id <> old.student_id) then
    raise exception 'Remove the student and add them again instead.'
      using errcode = 'check_violation';
  end if;
  -- A change of part only (witness -> target) is fine even if the event has
  -- since been made less serious; anything new must be on a serious event.
  if tg_op = 'UPDATE' then
    new.added_by := old.added_by;
    new.added_at := old.added_at;
    return new;
  end if;

  select * into v_event from behaviour_events where event_id = new.event_id;
  if not found then
    raise exception 'Behaviour event % not found.', new.event_id;
  end if;
  if v_event.voided_at is not null then
    raise exception 'This event was withdrawn on appeal.'
      using errcode = 'check_violation';
  end if;
  select serious_event_points into v_serious from behaviour_rules where id;
  if v_event.type <> 'negative' or v_event.points is null or v_event.points > coalesce(v_serious, -5) then
    raise exception 'Other students can only be added to a serious event (% points or worse).', coalesce(v_serious, -5)
      using errcode = 'check_violation';
  end if;
  if new.student_id = v_event.student_id then
    raise exception 'That is the student the event is about.'
      using errcode = 'check_violation';
  end if;
  new.added_at := now();
  return new;
end;
$$;

revoke execute on function public.behaviour_event_students_check() from public, anon, authenticated;

create trigger behaviour_event_students_check
  before insert or update on public.behaviour_event_students
  for each row execute function public.behaviour_event_students_check();

create trigger stamp_added_by
  before insert on public.behaviour_event_students
  for each row execute function public.stamp_actor('added_by');

-- 4. Change history -------------------------------------------------------------------------

create trigger trg_log_change
  after insert or update or delete on public.behaviour_event_students
  for each row execute function public.log_change('behaviour', 'event_id,student_id');
