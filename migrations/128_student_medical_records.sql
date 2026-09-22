-- Migration 128: student medical records — profile, conditions, growth/BMI,
-- sick bay log and immunisations, owned by a new `nurse` role.
--
-- Why: the only medical data the MIS holds today is `students.medical_notes`,
-- a single free-text column. It is NULL or empty for all 274 active students,
-- so nothing is being recorded and there is nothing to migrate — a clean
-- start rather than a rework.
--
-- That column was never going to be enough here. 272 of the 274 active
-- students board, which makes this a residential setting: the school is
-- responsible for day-to-day health, not just for holding an emergency
-- contact. A boarding school needs to answer questions a text field cannot:
-- who came to the sick bay this week, what was given and at what dose, was
-- the parent told, is this child's asthma inhaler in date, has this child
-- stopped growing. Those are rows, not prose.
--
-- Five tables, each earning its place:
--   student_medical             1:1 standing profile + consents
--   student_medical_conditions  allergies, conditions, regular medication
--   student_growth_measurements height/weight/BMI over time
--   student_clinic_visits       the sick bay day book
--   student_immunisations       vaccination record with next-due dates
--
-- Access: a new `nurse` role owns all of it. Clinical detail is deliberately
-- NOT readable by teachers, pastoral, houseparents or parents in this first
-- pass — widening it (e.g. a teachers-see-alerts-only view for trips and PE,
-- or houseparent read access scoped by my_house_scope()) is a separate
-- decision with its own migration, not something to fall into by default.
-- `students.medical_notes` is left alone for now; it can be retired once the
-- structured record is in use.

-- 1. The nurse role ------------------------------------------------------

insert into roles (role_name, description) values
  ('nurse', 'School nurse / sick bay — owns student medical records')
on conflict (role_name) do nothing;

-- Every medical policy below goes through this one helper, so widening
-- access later is a single function change rather than a sweep of policies.
-- user_has_staff_role() already lets `profiles.role = 'admin'` through.
create or replace function is_medical_staff()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select user_has_staff_role(array['nurse']);
$$;

grant execute on function is_medical_staff() to authenticated;

-- 2. Standing medical profile -------------------------------------------

create table if not exists student_medical (
  student_id integer primary key references students(student_id) on delete cascade,

  -- Genotype matters as much as blood group in this context: sickle cell
  -- trait/disease is common enough in Nigeria that a boarding school needs
  -- it on the record, and it changes how a crisis is handled.
  blood_group text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  genotype text check (genotype in ('AA','AS','SS','AC','SC','CC')),

  gp_name text,
  gp_phone text,
  preferred_hospital text,
  preferred_hospital_phone text,
  health_insurance_provider text,
  health_insurance_number text,

  -- Consents are the questions the sick bay has to answer at 2am, so they
  -- are booleans on the record rather than a line buried in free text.
  -- Nothing is assumed: all three default to false and must be collected.
  consent_first_aid boolean not null default false,
  consent_simple_analgesia boolean not null default false,   -- paracetamol etc without ringing home first
  consent_emergency_treatment boolean not null default false,

  carries_own_medication boolean not null default false,      -- e.g. an inhaler or EpiPen kept on the student
  dietary_requirements text,
  sport_restrictions text,
  notes text,

  -- A medical record that nobody revisits goes stale silently. Stamping the
  -- review makes "last checked two years ago" visible instead.
  last_reviewed_on date,
  last_reviewed_by uuid references profiles(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_student_medical_updated_at
  before update on student_medical
  for each row execute function set_updated_at();

-- 3. Allergies, conditions and regular medication ------------------------

-- One table rather than three: the sick bay reads them as a single "what do
-- I need to know about this child" list, and `kind` is enough to group them
-- on screen. dose/frequency are only meaningful for kind = 'medication'.
create table if not exists student_medical_conditions (
  condition_id bigserial primary key,
  student_id integer not null references students(student_id) on delete cascade,
  kind text not null check (kind in ('allergy', 'condition', 'medication', 'dietary')),
  label text not null,                                        -- 'Peanuts', 'Asthma', 'Salbutamol inhaler'
  severity text check (severity in ('mild', 'moderate', 'severe', 'life_threatening')),
  management text,                                            -- what to do about it / care plan
  dose text,
  frequency text,
  diagnosed_on date,
  -- Conditions are resolved, not deleted: a past condition is still history
  -- worth keeping, so it is deactivated rather than removed.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id)
);

create index if not exists idx_student_medical_conditions_student
  on student_medical_conditions (student_id, active);

-- 4. Growth record — height, weight, BMI ---------------------------------

create table if not exists student_growth_measurements (
  measurement_id bigserial primary key,
  student_id integer not null references students(student_id) on delete cascade,
  measured_on date not null default school_today(),
  height_cm numeric(5,1) check (height_cm > 30 and height_cm < 250),
  weight_kg numeric(5,1) check (weight_kg > 5 and weight_kg < 250),

  -- BMI is computed in the database, never in the browser: it is derived
  -- data, and a stored generated column means every reader — the app, an
  -- export, a future report — gets the same number from the same formula.
  bmi numeric(5,2) generated always as (
    case
      when height_cm is not null and weight_kg is not null and height_cm > 0
        then round(weight_kg / power(height_cm / 100.0, 2), 2)
    end
  ) stored,

  notes text,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now(),

  -- One measurement per child per day; re-measuring corrects the row.
  unique (student_id, measured_on)
);

create index if not exists idx_student_growth_student_date
  on student_growth_measurements (student_id, measured_on desc);

-- 4a. Interpreting a child's BMI ----------------------------------------
--
-- Adult BMI bands (18.5 / 25 / 30) are wrong for 9–18 year olds, which is
-- every student here. The correct reading is BMI-for-age as a z-score
-- against a growth reference (WHO 5–19), which needs the reference's LMS
-- parameters per sex and age in months.
--
-- That reference data is NOT invented here — this table ships empty, and
-- bmi_for_age_z() returns NULL until it is loaded from the published WHO
-- tables. A NULL z-score shows as "no reference loaded" in the app; it
-- never shows a made-up category. Loading it is a follow-up task.
create table if not exists bmi_for_age_reference (
  sex text not null check (sex in ('male', 'female')),
  age_months integer not null check (age_months between 0 and 240),
  l numeric not null,
  m numeric not null,
  s numeric not null,
  source text not null default 'WHO 2007 BMI-for-age 5-19',
  primary key (sex, age_months)
);

create or replace function bmi_for_age_z(p_sex text, p_age_months integer, p_bmi numeric)
returns numeric
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  -- Standard LMS transform: z = ((BMI/M)^L - 1) / (L*S), or ln(BMI/M)/S
  -- when L is zero.
  select case
           when r.l = 0 then round(ln(p_bmi / r.m) / r.s, 2)
           else round((power(p_bmi / r.m, r.l) - 1) / (r.l * r.s), 2)
         end
  from bmi_for_age_reference r
  where r.sex = lower(p_sex)
    and r.age_months = p_age_months
    and p_bmi is not null
    and p_bmi > 0;
$$;

grant execute on function bmi_for_age_z(text, integer, numeric) to authenticated;

-- Joins each measurement to the child's age at the time, which is what the
-- reference is indexed by. security_invoker so the RLS policies below still
-- apply — the three views fixed in the last security sweep were exactly
-- this mistake.
create or replace view student_growth_record
with (security_invoker = true) as
select
  g.measurement_id,
  g.student_id,
  g.measured_on,
  g.height_cm,
  g.weight_kg,
  g.bmi,
  g.notes,
  g.recorded_by,
  g.created_at,
  s.gender,
  ((extract(year from age(g.measured_on, s.dob)) * 12)
    + extract(month from age(g.measured_on, s.dob)))::integer as age_months,
  bmi_for_age_z(
    case lower(coalesce(s.gender, ''))
      when 'm' then 'male' when 'male' then 'male'
      when 'f' then 'female' when 'female' then 'female'
    end,
    ((extract(year from age(g.measured_on, s.dob)) * 12)
      + extract(month from age(g.measured_on, s.dob)))::integer,
    g.bmi
  ) as bmi_z
from student_growth_measurements g
join students s on s.student_id = g.student_id;

-- 5. Sick bay day book ---------------------------------------------------

create table if not exists student_clinic_visits (
  visit_id bigserial primary key,
  student_id integer not null references students(student_id) on delete cascade,
  -- school_now(), not now(): the database runs in UTC and is an hour behind
  -- Lagos, so a late-evening visit would otherwise be filed under tomorrow.
  visited_at timestamptz not null default school_now(),
  category text check (category in ('illness', 'injury', 'medication', 'routine', 'mental_health', 'other')),
  reason text not null,                                       -- presenting complaint
  temperature_c numeric(4,1) check (temperature_c between 30 and 45),
  observations text,
  treatment text,
  medication_given text,
  dose_given text,
  outcome text check (outcome in ('returned_to_class', 'rested_in_sick_bay', 'sent_home', 'referred_to_hospital', 'other')),
  -- Whether the parent was told is the single most-asked question after any
  -- incident, so it is a column and not a note.
  parent_notified boolean not null default false,
  parent_notified_at timestamptz,
  follow_up_needed boolean not null default false,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_student_clinic_visits_student
  on student_clinic_visits (student_id, visited_at desc);
create index if not exists idx_student_clinic_visits_date
  on student_clinic_visits (visited_at desc);

-- 6. Immunisations -------------------------------------------------------

create table if not exists student_immunisations (
  immunisation_id bigserial primary key,
  student_id integer not null references students(student_id) on delete cascade,
  vaccine text not null,
  dose_label text,                                            -- 'Dose 1', 'Booster'
  given_on date,
  -- The point of the record is catching what is due, so next_due_on is
  -- first-class rather than derived from a schedule the app would have to know.
  next_due_on date,
  batch_number text,
  administered_by text,                                       -- often an outside clinic, so free text
  notes text,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_student_immunisations_student
  on student_immunisations (student_id, given_on desc);
create index if not exists idx_student_immunisations_due
  on student_immunisations (next_due_on) where next_due_on is not null;

-- 7. RLS -----------------------------------------------------------------
--
-- Nurse (and admin, via user_has_staff_role) only. No parent policy, no
-- student policy, no general staff read: medical records are the most
-- sensitive data in this system and the default here is closed.

alter table student_medical enable row level security;
alter table student_medical_conditions enable row level security;
alter table student_growth_measurements enable row level security;
alter table student_clinic_visits enable row level security;
alter table student_immunisations enable row level security;
alter table bmi_for_age_reference enable row level security;

create policy medical_staff_manage_student_medical on student_medical
  for all using (is_medical_staff()) with check (is_medical_staff());

create policy medical_staff_manage_conditions on student_medical_conditions
  for all using (is_medical_staff()) with check (is_medical_staff());

create policy medical_staff_manage_growth on student_growth_measurements
  for all using (is_medical_staff()) with check (is_medical_staff());

create policy medical_staff_manage_clinic_visits on student_clinic_visits
  for all using (is_medical_staff()) with check (is_medical_staff());

create policy medical_staff_manage_immunisations on student_immunisations
  for all using (is_medical_staff()) with check (is_medical_staff());

-- The growth reference holds no personal data — it is published population
-- statistics — so any authenticated user may read it, but only an admin
-- loads it.
create policy anyone_read_bmi_reference on bmi_for_age_reference
  for select using (auth.role() = 'authenticated');
create policy admin_write_bmi_reference on bmi_for_age_reference
  for all using (is_admin()) with check (is_admin());

-- 8. Permissions / navigation -------------------------------------------
--
-- The medical record renders as a section on /students/[id], gated on this
-- resource key, so /admin/permissions can move it between roles without a
-- code change. The nurse also needs the student list itself to get there.

insert into resources (resource_key, label, section, sort_order) values
  ('/students/medical', 'Medical Records', 'Students', 18)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('nurse', '/students/medical'),
  ('nurse', '/students')
on conflict do nothing;
