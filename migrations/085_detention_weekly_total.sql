-- Migration 085: detentions should fire on two conditions, not one
--
-- handle_negative_behaviour() (never captured in this repo until the sweep that
-- found it) already does the "serious single event" half: any event of -5 points
-- or worse auto-inserts a Friday detention row. It never did the second condition —
-- a running weekly total (Sat-Fri) crossing a threshold — that's only ever been
-- computed live, client-side, on /detention (THRESHOLD = 10 in app/detention/page.js).
-- This adds that second condition to the same trigger function, using the same
-- threshold and the same Sat-Fri week window already used by
-- notify_pastoral_on_negative_behaviour() (sql/031_behaviour_email_alerts.sql).
--
-- Also fixes a real live bug found in passing: the original function had no
-- SECURITY DEFINER, so if a real (non-superuser) staff member's INSERT into
-- behaviour_events fired this trigger, the nested INSERT into detentions would
-- run as that staff member's own role — and since detentions has RLS enabled
-- with zero policies, that INSERT would have been silently denied, rolling back
-- the whole behaviour_events insert along with it. Declaring SECURITY DEFINER
-- (matching every other write-triggering function in this schema) fixes that.
--
-- detentions never got an is_demo column (it didn't exist when migration 075 added
-- is_demo everywhere else), so the one detention already on record — created from
-- this session's demo seed data — is backfilled here, and future inserts derive
-- is_demo directly from the triggering behaviour_events row.

alter table detentions add column if not exists is_demo boolean not null default false;

update detentions d
set is_demo = true
from behaviour_events be
where be.event_id = d.behaviour_event_id and be.is_demo = true;

create or replace function handle_negative_behaviour()
returns trigger
language plpgsql security definer as $$
declare
  week_start date;
  week_end date;
  week_total integer;
  detention_friday date;
begin
  if NEW.points <= -3 then
    perform pg_notify('behaviour_escalation', json_build_object(
      'event_id', NEW.event_id,
      'student_id', NEW.student_id,
      'points', NEW.points
    )::text);
  end if;

  week_start := NEW.event_date - (((extract(dow from NEW.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;
  detention_friday := week_start + 6; -- Friday of that Sat-Fri week

  -- Condition 1: a single serious event
  if NEW.points <= -5 then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select NEW.student_id, NEW.event_id, detention_friday, 'scheduled', NEW.is_demo
    where not exists (
      select 1 from detentions where behaviour_event_id = NEW.event_id
    );
  end if;

  -- Condition 2: weekly total crosses the same threshold /detention uses (10)
  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = NEW.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if week_total <= -10 then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select NEW.student_id, null, detention_friday, 'scheduled', NEW.is_demo
    where not exists (
      select 1 from detentions
      where student_id = NEW.student_id and detention_date = detention_friday and behaviour_event_id is null
    );
  end if;

  return NEW;
end;
$$;

-- RLS: pastoral/houseparent/smt can see and update detentions, scoped by is_demo
-- the same way as everywhere else; admins see and can touch everything.
drop policy if exists "pastoral_read_detentions" on detentions;
create policy "pastoral_read_detentions" on detentions for select using (
  is_pastoral_or_smt() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "pastoral_update_detentions" on detentions;
create policy "pastoral_update_detentions" on detentions for update using (
  is_pastoral_or_smt() and (is_demo = is_demo_account() or is_admin())
);
