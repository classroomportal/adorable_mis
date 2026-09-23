-- Migration 134: staff HR records — the data behind /staff/records.
--
-- Why: the only thing the database knew about a member of staff was their
-- name, code, email and roles. HR keeps police clearance dates, training,
-- disciplinary warnings, days off and lateness on paper, and wants them on a
-- single staff record they can edit.
--
-- None of it goes on `staff` itself. `staff` is readable by every signed-in
-- user (`read_all_staff`) because timetables, registers and class lists all
-- need names — a warning or a police clearance reference added there would be
-- readable by every teacher and, through the portals' joins, potentially
-- beyond. So the HR data lives in four tables of its own, readable by HR and
-- SMT and writable by HR (admins pass both through user_has_staff_role()'s
-- `p.role = 'admin'` branch). The photo lives with it for the same reason and
-- because `select('*')` on `staff` is used all over the app — a base64 photo
-- on that table would be dragged into every one of those loads.
--
-- Separately, HR already has /staff/roles but couldn't save a name, code or
-- email change there: `staff` writes were admin-only. HR now gets insert and
-- update on `staff` (not delete). The existing email trigger
-- (trg_staff_auto_login) is SECURITY DEFINER, so an HR edit to an email still
-- provisions the login exactly as an admin's does.

-- 1. Who may see and edit HR data ------------------------------------------

create or replace function can_read_staff_hr()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select user_has_staff_role(array['hr', 'smt']);
$$;

create or replace function can_manage_staff_hr()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select user_has_staff_role(array['hr']);
$$;

-- 2. One HR profile per member of staff ------------------------------------

create table if not exists staff_hr_profiles (
  staff_id integer primary key references staff(staff_id) on delete cascade,
  photo_base64 text,
  job_title text,
  department text,
  employment_type text check (employment_type in ('full_time', 'part_time', 'contract', 'temporary', 'volunteer')),
  date_of_appointment date,
  probation_end_date date,
  leaving_date date,
  annual_leave_days numeric(4,1) check (annual_leave_days is null or annual_leave_days >= 0),
  date_of_birth date,
  gender text,
  nationality text,
  phone text,
  personal_email text,
  address text,
  next_of_kin_name text,
  next_of_kin_relationship text,
  next_of_kin_phone text,
  police_clearance_date date,
  police_clearance_reference text,
  police_clearance_renewal_date date,
  qualifications text,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

comment on table staff_hr_profiles is
  'HR-only detail for a member of staff (appointment, police clearance, '
  'contact, next of kin, photo). Kept off `staff`, which every signed-in user '
  'can read. One row per staff member, created on first save.';

drop trigger if exists trg_staff_hr_profiles_updated_at on staff_hr_profiles;
create trigger trg_staff_hr_profiles_updated_at
  before update on staff_hr_profiles
  for each row execute function set_updated_at();

-- 3. Training taken ----------------------------------------------------------

create table if not exists staff_training (
  id bigint generated always as identity primary key,
  staff_id integer not null references staff(staff_id) on delete cascade,
  title text not null,
  provider text,
  completed_on date,
  expires_on date,
  certificate_reference text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists staff_training_staff_idx on staff_training (staff_id);

-- 4. Disciplinary warnings ---------------------------------------------------
--
-- expires_on is when a warning stops counting ("live" vs "spent"); blank
-- means it never lapses.

create table if not exists staff_warnings (
  id bigint generated always as identity primary key,
  staff_id integer not null references staff(staff_id) on delete cascade,
  issued_on date not null,
  level text not null check (level in ('verbal', 'written', 'final_written', 'other')),
  reason text not null,
  issued_by text,
  expires_on date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create index if not exists staff_warnings_staff_idx on staff_warnings (staff_id);

-- 5. Days off and lateness ---------------------------------------------------
--
-- One table for both, because HR records them in the same place and asks the
-- same question of them ("how many this year?"). A late arrival is one row
-- with minutes_late; an absence is one row per spell, with `days` entered by
-- HR rather than derived from the dates — half days and weekends in a spell
-- make a derived count wrong more often than right.

create table if not exists staff_attendance_records (
  id bigint generated always as identity primary key,
  staff_id integer not null references staff(staff_id) on delete cascade,
  record_type text not null check (record_type in (
    'late', 'sick', 'annual_leave', 'authorised_absence', 'unauthorised_absence', 'other'
  )),
  start_date date not null,
  end_date date,
  days numeric(4,1) check (days is null or days >= 0),
  minutes_late integer check (minutes_late is null or (minutes_late >= 0 and minutes_late <= 600)),
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  constraint staff_attendance_records_dates_check check (end_date is null or end_date >= start_date)
);

create index if not exists staff_attendance_records_staff_idx on staff_attendance_records (staff_id, start_date);

-- 6. RLS ---------------------------------------------------------------------

alter table staff_hr_profiles enable row level security;
alter table staff_training enable row level security;
alter table staff_warnings enable row level security;
alter table staff_attendance_records enable row level security;

-- Explicit Data API grants: from 30 Oct 2026 Supabase no longer grants new
-- public tables to the API roles automatically. RLS still decides the rows.
grant select, insert, update, delete on staff_hr_profiles to authenticated;
grant select, insert, update, delete on staff_training to authenticated;
grant select, insert, update, delete on staff_warnings to authenticated;
grant select, insert, update, delete on staff_attendance_records to authenticated;

drop policy if exists hr_read_staff_hr_profiles on staff_hr_profiles;
create policy hr_read_staff_hr_profiles on staff_hr_profiles for select using (can_read_staff_hr());
drop policy if exists hr_write_staff_hr_profiles on staff_hr_profiles;
create policy hr_write_staff_hr_profiles on staff_hr_profiles for all using (can_manage_staff_hr()) with check (can_manage_staff_hr());

drop policy if exists hr_read_staff_training on staff_training;
create policy hr_read_staff_training on staff_training for select using (can_read_staff_hr());
drop policy if exists hr_write_staff_training on staff_training;
create policy hr_write_staff_training on staff_training for all using (can_manage_staff_hr()) with check (can_manage_staff_hr());

drop policy if exists hr_read_staff_warnings on staff_warnings;
create policy hr_read_staff_warnings on staff_warnings for select using (can_read_staff_hr());
drop policy if exists hr_write_staff_warnings on staff_warnings;
create policy hr_write_staff_warnings on staff_warnings for all using (can_manage_staff_hr()) with check (can_manage_staff_hr());

drop policy if exists hr_read_staff_attendance_records on staff_attendance_records;
create policy hr_read_staff_attendance_records on staff_attendance_records for select using (can_read_staff_hr());
drop policy if exists hr_write_staff_attendance_records on staff_attendance_records;
create policy hr_write_staff_attendance_records on staff_attendance_records for all using (can_manage_staff_hr()) with check (can_manage_staff_hr());

-- 7. HR can edit the core staff row too -------------------------------------

drop policy if exists hr_insert_staff on staff;
create policy hr_insert_staff on staff for insert with check (can_manage_staff_hr());
drop policy if exists hr_update_staff on staff;
create policy hr_update_staff on staff for update using (can_manage_staff_hr()) with check (can_manage_staff_hr());

-- 8. The page ----------------------------------------------------------------

insert into resources (resource_key, label, section, sort_order) values
  ('/staff/records', 'Staff Records', 'Staff & Access', 89)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('admin', '/staff/records'),
  ('hr', '/staff/records'),
  ('smt', '/staff/records')
on conflict do nothing;
