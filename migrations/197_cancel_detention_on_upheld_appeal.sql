-- 197_cancel_detention_on_upheld_appeal.sql
--
-- An upheld appeal voids its event (migration 196), but a detention the event
-- had already triggered stayed scheduled. handle_negative_behaviour() sets
-- detentions two ways, and an upheld appeal now undoes both:
--
--   * a single event of -5 or worse gets its own detention
--     (behaviour_event_id = the event) - cancelled outright;
--   * reaching -10 negative points in a week gets a weekly detention
--     (behaviour_event_id null, dated to that week's Friday) - cancelled if,
--     without the voided event, the week's total is no longer -10 or worse.
--
-- Only 'scheduled' detentions are cancelled; one already attended is left as
-- a record of what happened. The week is worked out exactly as
-- handle_negative_behaviour() does (Saturday to Friday). The event's points
-- are zeroed before the weekly total is taken, and voided events are left out
-- of it too, so the total reflects only events that still stand.

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
    set points = 0,
        voided_at = coalesce(new.reviewed_at, now())
    where event_id = new.event_id
    returning * into v_event;

    if v_event.event_id is not null then
      update detentions set status = 'cancelled'
      where behaviour_event_id = v_event.event_id and status = 'scheduled';

      v_week_start := v_event.event_date - (((extract(dow from v_event.event_date)::int - 6 + 7) % 7));

      select coalesce(sum(points), 0) into v_week_total
      from behaviour_events
      where student_id = v_event.student_id and type = 'negative' and voided_at is null
        and event_date between v_week_start and v_week_start + 6;

      if v_week_total > -10 then
        update detentions set status = 'cancelled'
        where student_id = v_event.student_id
          and detention_date = v_week_start + 6
          and behaviour_event_id is null
          and status = 'scheduled';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- Detentions already set by events whose appeals were upheld before this.
update public.detentions d
set status = 'cancelled'
from public.behaviour_events e
where d.behaviour_event_id = e.event_id and e.voided_at is not null and d.status = 'scheduled';

update public.detentions d
set status = 'cancelled'
where d.behaviour_event_id is null and d.status = 'scheduled'
  and exists (
    select 1 from behaviour_events v
    where v.student_id = d.student_id and v.voided_at is not null and v.type = 'negative'
      and v.event_date between d.detention_date - 6 and d.detention_date
  )
  and (
    select coalesce(sum(e.points), 0) from behaviour_events e
    where e.student_id = d.student_id and e.type = 'negative' and e.voided_at is null
      and e.event_date between d.detention_date - 6 and d.detention_date
  ) > -10;
