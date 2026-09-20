-- 107_staff_commitments.sql
-- Nova-T exports a teacher's non-teaching commitments (meetings, part-time
-- non-working periods, etc.) in a separate file (NCLASS.DAT) from the
-- teaching-group timetable (TBTRA-F.DAT) — it has no student roster, so it
-- never fit the classes/timetable_slots model. This just blocks the slot out
-- on that staff member's own timetable; nothing else in the app reads it
-- (no register, no roster).
--
-- NCLASS.DAT row shape: "Meeting ,38,CBT,    " = label, slot number, staff
-- code, room (always blank). Slot number decodes the same way TBTRA-F.DAT's
-- slot column does: day_of_week = ['Mon','Tue','Wed','Thu','Fri'][(slot-1) % 5],
-- period_number = floor((slot-1) / 5) + 1.

create table if not exists staff_commitments (
  commitment_id serial primary key,
  staff_id integer not null references staff(staff_id) on delete cascade,
  day_of_week text not null,
  period_number integer not null references periods(period_number),
  label text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (staff_id, day_of_week, period_number, is_demo)
);

alter table staff_commitments enable row level security;

create trigger trg_set_is_demo
  before insert on staff_commitments
  for each row execute function set_is_demo();

create policy staff_read_commitments on staff_commitments
  for select
  using (is_staff_or_admin() and (is_demo = is_demo_account() or is_admin()));

create policy admin_write_commitments on staff_commitments
  for all
  using (is_admin())
  with check (is_admin());
