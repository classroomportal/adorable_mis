-- 222_keep_points_on_upheld_appeal.sql
--
-- When an appeal was upheld, void_event_on_upheld_appeal() set the event's
-- points to 0 (migration 196), so the record of what the student had actually
-- been given was lost: /appeals could only show "Disruption in class" with no
-- sign it had been a -2, and pastoral staff reviewing past appeals couldn't
-- see what had been withdrawn.
--
-- The event now keeps its original points in voided_points when it is voided.
-- points is still zeroed (and voided_at still set), so every total, detention
-- rule and portal that already ignores voided events is unaffected; nothing
-- that sums points needs to know about the new column. The event's category
-- and description were always kept and are left as they are.
--
-- Events voided before this migration: their points were already overwritten,
-- so they are restored from the category's default_points. Since migrations
-- 140-141 an event's points always equal its category's, so this is the value
-- each one carried (checked against live data before applying: six upheld
-- appeals, every category matched).

alter table public.behaviour_events add column voided_points integer;

create or replace function public.void_event_on_upheld_appeal()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event behaviour_events%rowtype;
  v_week_start date;
  v_week_total integer;
begin
  if new.status = 'upheld' and (old.status is distinct from 'upheld') then
    update behaviour_events
    set voided_points = points,
        points = 0,
        voided_at = coalesce(new.reviewed_at, now())
    where event_id = new.event_id and voided_at is null
    returning * into v_event;

    if v_event.event_id is not null then
      v_week_start := v_event.event_date - (((extract(dow from v_event.event_date)::int - 6 + 7) % 7));

      select coalesce(sum(points), 0) into v_week_total
      from behaviour_events
      where student_id = v_event.student_id and type = 'negative' and voided_at is null
        and event_date between v_week_start and v_week_start + 6;

      update detentions set status = 'cancelled'
      where status = 'scheduled'
        and (
          behaviour_event_id = v_event.event_id
          or (v_week_total > -10
              and student_id = v_event.student_id
              and detention_date = v_week_start + 6
              and behaviour_event_id is null)
        );
    end if;
  end if;
  return new;
end;
$function$;

-- Events voided before this migration.
update public.behaviour_events e
set voided_points = c.default_points
from public.behaviour_categories c
where e.voided_at is not null
  and e.voided_points is null
  and c.name = e.category
  and c.type = e.type;
