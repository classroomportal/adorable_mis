-- 138_behaviour_events_record_logged_by.sql
-- behaviour_events.staff_id ("Logged by") was null on every one of the 836
-- rows: the /behaviour form never sent it and nothing in the database filled
-- it in, so no event recorded who logged it — including the serious ones
-- school office reviews before parents see them.
--
-- Fill it from the logged-in user's linked staff record on insert. It is set
-- from auth.uid() rather than trusted from the client, so nobody can log an
-- event under a colleague's name. When there is no logged-in user (SQL editor,
-- service role), whatever the statement supplied is kept.
--
-- Existing rows stay null: behaviour_event_audit has never recorded anything,
-- so there is no history to backfill from.

create or replace function set_behaviour_event_logged_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id integer;
begin
  if auth.uid() is not null then
    select staff_id into v_staff_id from profiles where id = auth.uid();
    new.staff_id := v_staff_id;
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_event_logged_by on behaviour_events;
create trigger behaviour_event_logged_by
  before insert on behaviour_events
  for each row execute function set_behaviour_event_logged_by();
