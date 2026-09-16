-- Migration 075: is_demo column on every table the staff_demo training account touches
-- Marks which rows are fake so they can be filtered out of real staff's view (076),
-- filtered into the demo account's view (076), and deleted on nightly reset (079).
-- Denormalised directly onto each table rather than inferred via a join back to
-- students, matching the existing student_class.block_id precedent (017/073) —
-- keeps RLS predicates a single cheap column comparison, not a subquery per row.

alter table students             add column if not exists is_demo boolean not null default false;
alter table classes              add column if not exists is_demo boolean not null default false;
alter table timetable_slots      add column if not exists is_demo boolean not null default false;
alter table student_class        add column if not exists is_demo boolean not null default false;
alter table staff                add column if not exists is_demo boolean not null default false;
alter table results              add column if not exists is_demo boolean not null default false;
alter table target_grades        add column if not exists is_demo boolean not null default false;
alter table behaviour_events     add column if not exists is_demo boolean not null default false;
alter table behaviour_appeals    add column if not exists is_demo boolean not null default false;
alter table attendance           add column if not exists is_demo boolean not null default false;
alter table certificates_awarded add column if not exists is_demo boolean not null default false;

-- The three tables staff_demo can write to live through the unmodified app never
-- have the client set is_demo explicitly, so a trigger derives it server-side —
-- otherwise every insert from the demo account would default to is_demo=false and
-- immediately fail the tightened write check added in 077.
create or replace function set_is_demo() returns trigger as $$
begin
  new.is_demo := is_demo_account();
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_is_demo on behaviour_events;
create trigger trg_set_is_demo before insert on behaviour_events
  for each row execute function set_is_demo();

drop trigger if exists trg_set_is_demo on attendance;
create trigger trg_set_is_demo before insert on attendance
  for each row execute function set_is_demo();

drop trigger if exists trg_set_is_demo on certificates_awarded;
create trigger trg_set_is_demo before insert on certificates_awarded
  for each row execute function set_is_demo();
