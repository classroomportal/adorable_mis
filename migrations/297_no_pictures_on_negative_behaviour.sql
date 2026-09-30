-- Pictures only on positive behaviour events.
--
-- Migration 209 let staff attach a picture to any behaviour event. The
-- principal decided (30 Sept 2026) that pictures are for positive events
-- only: a picture of damage or of a student behind a sanction is not
-- something the school wants attached to a negative record. The six negative
-- events that already had one were all rejected by the school office, so no
-- parent ever saw them; they are left as they are (staff can still see them).
--
-- /behaviour now hides the picture field for negative events, but staff can
-- insert and update behaviour_events directly (staff_write_behaviour /
-- staff_update_behaviour), so the rule is enforced here. It refuses a picture
-- on a new negative event, a picture newly linked to a negative event, and an
-- event with a picture being changed to negative. Updates that touch neither
-- photo_id nor type (the existing six, say, having their comment edited) are
-- not affected.

create or replace function public.behaviour_event_photo_positive_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.type = 'negative' and new.photo_id is not null
     and (tg_op = 'INSERT'
          or new.photo_id is distinct from old.photo_id
          or new.type is distinct from old.type) then
    raise exception 'Pictures can only be added to positive behaviour events.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger behaviour_event_photo_positive_only
  before insert or update of photo_id, type on public.behaviour_events
  for each row execute function public.behaviour_event_photo_positive_only();
