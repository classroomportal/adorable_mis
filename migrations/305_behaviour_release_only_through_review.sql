-- Migration 305: a negative behaviour event reaches parents only through the
-- review.
--
-- Why (the principal, 1 Oct 2026, after migration 304): staff_update_behaviour
-- and staff_write_behaviour let any member of staff write behaviour_events
-- directly, so a copied request could set visible_to_parents on a negative
-- event (or insert one already visible), skipping the school office / SMT
-- review at /behaviour/review (migrations 106, 238, 239), or change a
-- released positive event to negative. The pages never do this: every change
-- goes through edit_behaviour_event(), review_serious_behaviour_event(),
-- review_behaviour_for_parents() and void_event_on_upheld_appeal(), all
-- SECURITY DEFINER, so they run as their owner, not as 'authenticated'.
--
-- Now, for requests from the app (current_user = 'authenticated'), the same
-- pattern as applicants_guard() (migration 256):
--   - a new negative event must start hidden from parents and unreviewed;
--   - visible_to_parents, protocol_reviewed_by, protocol_reviewed_at and
--     type can't be changed directly.
-- Positive events are still made visible on insert by
-- set_behaviour_event_default_visibility(), which this leaves alone.

set local formwork.change_note = 'Principal (direct)';

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
    return new;
  end if;

  if new.visible_to_parents is distinct from old.visible_to_parents
     or new.protocol_reviewed_by is distinct from old.protocol_reviewed_by
     or new.protocol_reviewed_at is distinct from old.protocol_reviewed_at
     or new.type is distinct from old.type then
    raise exception 'Whether parents see a behaviour event is decided through the review at /behaviour/review, and an event''s type can''t be changed.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

revoke execute on function public.behaviour_event_release_guard() from public, anon, authenticated;

-- Named to run after behaviour_event_default_visibility (triggers fire in name order).
create trigger behaviour_event_release_guard
  before insert or update on public.behaviour_events
  for each row execute function public.behaviour_event_release_guard();
