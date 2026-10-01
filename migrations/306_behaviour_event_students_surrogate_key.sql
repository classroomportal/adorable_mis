-- Migration 306: stop behaviour_event_students breaking every behaviour list.
--
-- Why (the principal, 1 Oct 2026, a screenshot of /behaviour/log): "Could not
-- embed because more than one relationship was found for 'behaviour_events'
-- and 'students'". Migration 303 gave behaviour_event_students a primary key
-- of (event_id, student_id), both foreign keys. PostgREST reads a table like
-- that as a many-to-many junction, so behaviour_events now reached students
-- two ways (directly through student_id, and through the junction), and every
-- page that asks for an event's students(...) was refused: the Behaviour Log,
-- /behaviour's recent list, /behaviour/review and /behaviour/alerts.
--
-- Now the table has its own id as primary key, and "one row per student per
-- event" is kept by a unique index rather than a constraint. PostgREST builds
-- junctions only from constraints, so the second route disappears; the
-- foreign keys, policies, triggers and change-history logging all stay.
-- The pages also name the foreign key in those embeds from now on
-- (students!behaviour_events_student_id_fkey), as they already do for staff.

set local formwork.change_note = 'Principal (direct)';

alter table public.behaviour_event_students drop constraint behaviour_event_students_pkey;
alter table public.behaviour_event_students add column id bigint generated always as identity;
alter table public.behaviour_event_students add primary key (id);
create unique index behaviour_event_students_event_student_key
  on public.behaviour_event_students (event_id, student_id);

notify pgrst, 'reload schema';
