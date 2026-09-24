-- 165_detention_threshold_matches_serious.sql
-- A student logged with a serious event did not appear on the detention list.
--
-- Migration 135 moved the "serious" threshold to -3: the behaviour form and
-- /behaviour/review both call anything -3 or worse a serious event. But the
-- automatic single-event detention in handle_negative_behaviour() was left
-- behind at -5 (135's header says -4; the live function actually said -5), so
-- a -3 or -4 "serious" event — e.g. Stage 3, Rudeness/disrespect — quietly
-- produced no detention. Staff reasonably read "serious" as "gets a detention",
-- so the two thresholds are brought back into line here at -3.
--
-- The function is otherwise unchanged from the live version (same Sat-Fri
-- week, same Friday detention date, same 10-point weekly total from 085).
--
-- Backfill: the trigger only runs on INSERT, so events already logged need
-- their detention added by hand. Only events whose detention Friday is today
-- or later are backfilled — handing out detentions for weeks that have already
-- passed would be meaningless. When this was written that was five -3 events
-- from 23-24 September 2026, all due on Friday 25 September.

create or replace function handle_negative_behaviour()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  week_start date;
  week_end date;
  week_total integer;
  detention_friday date;
begin
  if new.points <= -3 then
    perform pg_notify('behaviour_escalation', json_build_object(
      'event_id', new.event_id,
      'student_id', new.student_id,
      'points', new.points
    )::text);
  end if;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;
  detention_friday := week_start + 6;

  if new.points <= -3 then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, new.event_id, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions where behaviour_event_id = new.event_id
    );
  end if;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if week_total <= -10 then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, null, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions
      where student_id = new.student_id and detention_date = detention_friday and behaviour_event_id is null
    );
  end if;

  return new;
end;
$$;

insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
select be.student_id,
       be.event_id,
       be.event_date - ((extract(dow from be.event_date)::int - 6 + 7) % 7) + 6,
       'scheduled',
       be.is_demo
from behaviour_events be
where be.points <= -3
  and be.event_date - ((extract(dow from be.event_date)::int - 6 + 7) % 7) + 6 >= current_date
  and not exists (select 1 from detentions d where d.behaviour_event_id = be.event_id);
