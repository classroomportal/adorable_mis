-- 145_behaviour_event_class.sql
-- Parents should see which subject a behaviour event happened in, but not
-- which teacher gave it (students see the teacher; parents don't). Events
-- recorded no class or subject, so there was nothing to show.
--
-- behaviour_events.class_id records the class. The /behaviour form sends it
-- when the teacher picked a lesson or mentor group; otherwise this trigger
-- works it out from the classes the logging teacher (staff_id, set by
-- migration 138's trigger, which runs first alphabetically) teaches that
-- student:
--   * exactly one shared non-Mentor class -> that class
--   * no non-Mentor class but exactly one Mentor group -> that group
--   * anything else is ambiguous -> left null ("—" to parents)
-- A class_id the student isn't actually in is discarded and re-derived.
-- The subject shown to parents comes from classes.subject_id.
-- Existing events stay null: nobody recorded who logged them, so there is
-- nothing to derive from.

alter table behaviour_events
  add column if not exists class_id integer references classes(class_id) on delete set null;

create or replace function set_behaviour_event_class()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids integer[];
begin
  if new.class_id is not null and not exists (
    select 1 from student_class sc
    where sc.class_id = new.class_id and sc.student_id = new.student_id
  ) then
    new.class_id := null;
  end if;

  if new.class_id is not null or new.staff_id is null then
    return new;
  end if;

  select array_agg(c.class_id) into v_ids
  from classes c
  join student_class sc on sc.class_id = c.class_id
  left join curriculum_blocks cb on cb.block_id = c.block_id
  where c.staff_id = new.staff_id
    and sc.student_id = new.student_id
    and cb.block_name is distinct from 'Mentor';

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    select array_agg(c.class_id) into v_ids
    from classes c
    join student_class sc on sc.class_id = c.class_id
    join curriculum_blocks cb on cb.block_id = c.block_id
    where c.staff_id = new.staff_id
      and sc.student_id = new.student_id
      and cb.block_name = 'Mentor';
  end if;

  if array_length(v_ids, 1) = 1 then
    new.class_id := v_ids[1];
  end if;
  return new;
end;
$$;

drop trigger if exists behaviour_event_set_class on behaviour_events;
create trigger behaviour_event_set_class
  before insert on behaviour_events
  for each row execute function set_behaviour_event_class();
