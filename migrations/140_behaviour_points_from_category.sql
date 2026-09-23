-- 140_behaviour_points_from_category.sql
-- Points for each behaviour category are set centrally (behaviour_categories.
-- default_points, admin-only via /admin/lookups). Staff recording an event
-- could still type any number into the Points box, and 10 events had been
-- saved with points that didn't match their category. The form now shows the
-- points read-only; this trigger is what actually enforces it, since pages
-- talk to Supabase directly and the form can be bypassed.
--
-- INSERT: points always come from the category (matched on name + type). An
--   event with no category, or one that isn't in the list, is refused — this
--   also stops the blank events that were being saved (see migration 139).
-- UPDATE: changing category/type re-derives the points. Changing points on
--   their own is refused, except setting them to 0: that is how an upheld
--   appeal voids an event (void_event_on_upheld_appeal()).
-- No logged-in user (SQL editor, service role): left alone, so an admin can
--   still correct a row by hand.
--
-- Existing rows are not rewritten; the trigger only acts on new inserts and
-- on updates that touch these columns.

create or replace function set_behaviour_event_points_from_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      raise exception 'Behaviour points are set by the category and cannot be changed';
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
$$;

drop trigger if exists behaviour_event_points_from_category on behaviour_events;
create trigger behaviour_event_points_from_category
  before insert or update of points, category, type on behaviour_events
  for each row execute function set_behaviour_event_points_from_category();
