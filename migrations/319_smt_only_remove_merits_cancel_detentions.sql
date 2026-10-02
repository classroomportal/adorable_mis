-- Migration 319: only SMT can remove a merit or cancel a detention.
--
-- Why (the principal, 2 Oct 2026): removing a merit or cancelling a detention
-- should be a senior management decision. "Senior management" means holding
-- the smt role in staff_roles; an admin login alone is not enough (the
-- principal's choice, so mis-sa@ loses this).
--
-- Before this:
--   - behaviour_events could be deleted by any admin login
--     (admin_delete_behaviour, is_admin());
--   - staff_update_behaviour let any member of staff write voided_at (which
--     hides an event everywhere, as an upheld appeal does), voided_points or
--     student_id directly, from a copied request; the pages never do this;
--   - anyone with the /detention page (office, pastoral, HR, mentors...) could
--     set a detention to 'cancelled' (migration 240), and could also move its
--     date or student, which amounts to the same.
--
-- Now:
--   1. Deleting a behaviour event (positive or negative) needs the smt role.
--   2. From the app, voided_at, voided_points and student_id can't be changed
--      on behaviour_events (added to behaviour_event_release_guard(),
--      migration 305). Withdrawing an event stays with the appeal trigger.
--   3. From the app, a detention's status is the only thing that can change,
--      and setting it to 'cancelled' needs the smt role. Everyone with the page
--      can still mark attended / missed, and put a cancelled one back.
--
-- Deliberately unchanged (the principal's choice): detentions still cancel
-- automatically when edit_behaviour_event() moves a negative event below the
-- thresholds, and when void_event_on_upheld_appeal() withdraws an event. Both
-- are SECURITY DEFINER, so they don't run as 'authenticated' and the guards
-- below let them through. Editing a merit's category through
-- edit_behaviour_event() is a correction, not a removal, and is unchanged.

set local formwork.change_note = 'Principal (direct)';

-- 1. Deleting an event ----------------------------------------------------------------

drop policy if exists admin_delete_behaviour on public.behaviour_events;
create policy smt_delete_behaviour on public.behaviour_events
  for delete
  using (has_staff_role(array['smt']));

-- 2. Voiding / moving an event from the app ---------------------------------------------

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
  return new;
end;
$$;

revoke execute on function public.behaviour_event_release_guard() from public, anon, authenticated;

-- 3. Cancelling a detention -------------------------------------------------------------

create or replace function public.detention_cancel_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- edit_behaviour_event() and void_event_on_upheld_appeal() cancel
  -- detentions automatically; they run as their owner, not 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.student_id is distinct from old.student_id
     or new.behaviour_event_id is distinct from old.behaviour_event_id
     or new.detention_date is distinct from old.detention_date
     or new.is_demo is distinct from old.is_demo
     or new.created_at is distinct from old.created_at
     or new.student_notified_at is distinct from old.student_notified_at
     or new.reminded_at is distinct from old.reminded_at then
    raise exception 'Only a detention''s status can be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and not has_staff_role(array['smt']) then
    raise exception 'Only SMT can cancel a detention.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.detention_cancel_guard() from public, anon, authenticated;

create trigger detention_cancel_guard
  before update on public.detentions
  for each row execute function public.detention_cancel_guard();
