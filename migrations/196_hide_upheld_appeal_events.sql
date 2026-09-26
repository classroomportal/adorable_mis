-- 196_hide_upheld_appeal_events.sql
--
-- When a behaviour appeal was upheld, void_event_on_upheld_appeal() set the
-- event's points to 0 and appended "(voided — appeal upheld)" to its
-- description, but the event itself stayed in the student's log: the student
-- portal, the parent portal and staff pages all still listed it. An upheld
-- appeal means the event shouldn't have been given, so it should disappear
-- from the log altogether.
--
-- The event is kept (the appeal still points at it, and /appeals shows what
-- was appealed) but marked with voided_at. Students and parents are stopped
-- from reading voided events by RLS, so neither portal can show one whatever
-- the page asks for; staff pages that list or total a student's behaviour
-- filter on voided_at themselves, since pastoral/SMT still need to see the
-- event on /appeals. Points are still zeroed, so any total that misses the
-- filter isn't thrown off.

alter table public.behaviour_events add column voided_at timestamptz;

create or replace function public.void_event_on_upheld_appeal()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.status = 'upheld' and (old.status is distinct from 'upheld') then
    update behaviour_events
    set points = 0,
        voided_at = coalesce(new.reviewed_at, now())
    where event_id = new.event_id;
  end if;
  return new;
end;
$function$;

-- Events whose appeals were upheld before this migration.
update public.behaviour_events e
set voided_at = coalesce(a.reviewed_at, now())
from public.behaviour_appeals a
where a.event_id = e.event_id and a.status = 'upheld' and e.voided_at is null;

alter policy student_read_own_behaviour on public.behaviour_events
  using (
    voided_at is null
    and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.student_id = behaviour_events.student_id
    )
  );

alter policy parent_read_own_behaviour on public.behaviour_events
  using (
    voided_at is null
    and visible_to_parents
    and exists (
      select 1 from profiles p
      join student_parent sp on sp.parent_id = p.parent_id
      where p.id = auth.uid() and sp.student_id = behaviour_events.student_id
    )
  );
