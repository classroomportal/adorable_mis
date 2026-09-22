-- Migration 130: termly resumption medical screening — the medical form a
-- boarder comes back to school with, and the check the nurse does on arrival.
--
-- Why: 272 of 274 students board, so every term begins with 274 children
-- arriving from eight weeks the school knows nothing about. The resumption
-- screening is how that gap gets closed: the form from home is collected,
-- the child is examined system by system, medication brought from home is
-- handed in, and someone decides whether they are fit to resume. Until now
-- none of that had anywhere to live.
--
-- Two tables rather than one wide one:
--
--   student_medical_screenings   one row per student per term — the vitals,
--                                the paperwork, the fitness decision
--   student_screening_findings   one row per body system examined
--
-- The findings are a child table because a screening examines a dozen
-- systems and the list is not fixed forever: adding "Mental health /
-- emotional state" to the round should be an app-side change, not twenty
-- more columns and a migration. It also makes "who has an abnormal finding
-- this term" a plain query instead of a twenty-column OR.
--
-- Height and weight are deliberately NOT columns here. They already have a
-- home in student_growth_measurements, where BMI is a generated column, and
-- duplicating them would mean two heights for one child on one day with
-- nothing to say which is right. The screening form writes straight to the
-- growth table and reads BMI back from it.
--
-- The item list below is modelled on the resumption medical check commonly
-- used by Nigerian boarding schools. It is a starting point to be confirmed
-- and trimmed against this school's own form, not a published standard —
-- the app-side list in lib/medical.js is what the form renders, so changing
-- it needs no migration.

create table if not exists student_medical_screenings (
  screening_id bigserial primary key,
  student_id integer not null references students(student_id) on delete cascade,
  term_id integer not null references terms(term_id),
  screening_type text not null default 'resumption'
    check (screening_type in ('resumption', 'routine', 'exit', 'pre_travel')),
  screened_on date not null default school_today(),

  -- Vitals. Height/weight live in student_growth_measurements; see above.
  temperature_c numeric(4,1) check (temperature_c between 30 and 45),
  pulse_bpm integer check (pulse_bpm between 20 and 250),
  respiratory_rate integer check (respiratory_rate between 5 and 90),
  bp_systolic integer check (bp_systolic between 50 and 260),
  bp_diastolic integer check (bp_diastolic between 30 and 180),

  -- Bedside/lab results a resumption check commonly collects. All optional:
  -- a school that does not run them leaves them blank rather than being
  -- forced to invent a value.
  pcv_percent numeric(4,1) check (pcv_percent between 5 and 70),
  malaria_test text check (malaria_test in ('not_done', 'negative', 'positive')),
  urinalysis text,
  other_tests text,

  -- The paperwork half of the check.
  parent_form_received boolean not null default false,   -- the medical form filled in at home
  holiday_illness text,                                  -- anything that happened over the break
  current_medication text,
  medication_handed_in boolean not null default false,   -- boarders surrender medicines to the sick bay
  medication_handed_in_detail text,
  allergies_confirmed boolean not null default false,
  blood_group_confirmed boolean not null default false,
  genotype_confirmed boolean not null default false,
  immunisations_up_to_date boolean not null default false,

  -- The decision. 'pending' is the honest default: a screening that has been
  -- started but not concluded should not read as a clean bill of health.
  fitness text not null default 'pending'
    check (fitness in ('pending', 'fit', 'fit_with_restrictions', 'not_fit')),
  restrictions text,
  referral_needed boolean not null default false,
  referral_detail text,
  recommendations text,
  notes text,

  screened_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One resumption screening per student per term. Re-opening the form
  -- corrects that row rather than creating a second, contradictory one.
  unique (student_id, term_id, screening_type)
);

create trigger trg_student_medical_screenings_updated_at
  before update on student_medical_screenings
  for each row execute function set_updated_at();

create index if not exists idx_screenings_term on student_medical_screenings (term_id, fitness);
create index if not exists idx_screenings_student on student_medical_screenings (student_id, screened_on desc);

create table if not exists student_screening_findings (
  finding_id bigserial primary key,
  screening_id bigint not null references student_medical_screenings(screening_id) on delete cascade,
  -- Free text rather than an enum: the list of systems examined is owned by
  -- the app (lib/medical.js), so the school can add or drop one without a
  -- migration. The UI only ever writes keys from that list.
  system text not null,
  status text not null default 'not_examined'
    check (status in ('normal', 'abnormal', 'not_examined')),
  note text,
  unique (screening_id, system)
);

create index if not exists idx_screening_findings_abnormal
  on student_screening_findings (screening_id) where status = 'abnormal';

-- RLS: same closed default as migration 128 — nurse and admin only, through
-- the one is_medical_staff() helper so widening stays a single change.
alter table student_medical_screenings enable row level security;
alter table student_screening_findings enable row level security;

create policy medical_staff_manage_screenings on student_medical_screenings
  for all using (is_medical_staff()) with check (is_medical_staff());

create policy medical_staff_manage_screening_findings on student_screening_findings
  for all using (is_medical_staff()) with check (is_medical_staff());

insert into resources (resource_key, label, section, sort_order) values
  ('/clinic/screenings', 'Resumption Screening', 'Clinic', 5)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('nurse', '/clinic/screenings')
on conflict do nothing;
