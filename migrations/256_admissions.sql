-- Migration 256: Admissions, phase 1 (/admissions).
--
-- Why: the school has no admissions records in Formwork. Applications for
-- 2027/28 entry are handled on paper, and there was no academic year to file
-- them under. The design, agreed with the principal on 29 Sept 2026, is in
-- docs/admissions-and-year-rollover-design.md (Decision 1 and Decision 3).
-- This migration is phase 1 of it: everything up to and including the
-- deposit. Turning a paid applicant into a student (enrol_applicant(), the
-- 'incoming' status) is phase 2 and is not here.
--
-- How the school runs admissions (the principal's answers):
--   * entry is possible into any year, 7 to 12, and every student boards;
--   * the family pays for the admission form (recorded by the bursar),
--     then a test date is fixed;
--   * English and Maths, a different paper for each year group, plus CAT4;
--     the pass mark is a 50% average of English and Maths;
--   * the result is posted: invited to the oral interview, waiting list,
--     or rejected;
--   * at the interview, interests are collected and a reading age is taken
--     with an older paper-based test (not NGRT);
--   * admissions staff make offers by letter, from the school's standard
--     letters; a family that accepts pays a deposit (recorded by the
--     bursar) before the place is final;
--   * applicant records are kept indefinitely for now.
--
-- What is where:
--   * academic_years: '2026/27' (current) and '2027/28' (planning), with the
--     admission form fee, deposit and pass mark for that entry year. terms
--     gain academic_year_id, backfilled and then filled from start_date.
--   * previous_schools: a lookup, so one school isn't three spellings.
--   * applicants + applicant_contacts: the child and their family.
--   * admission_papers: the English and Maths paper for each year group,
--     with its maximum mark, so scores become percentages.
--   * admission_sessions: test days. admission_test_scores, admission_cat4:
--     the results. applicant_interviews: interview, interests, reading age.
--   * admission_letter_templates: the standard letters, with merge fields.
--     They start empty; the principal is uploading the wording.
--     applicant_letters: every letter as it was produced, kept for good.
--   * applicant_test_summary: English %, Maths %, average, and whether it
--     reaches the pass mark. A view, so the average is never stored stale.
--
-- Who decides what (the database decides, not the page):
--   * An applicant's status, the fee and deposit fields, the decision and
--     the link to a student can't be written by the page directly. A BEFORE
--     trigger rejects them from the API roles (the same current_user test as
--     migration 151); only the functions below, which check the caller
--     first, can change them:
--       book_admission_test()        admissions: fixes the test date
--       post_admission_decision()    admissions: every other status change,
--                                    producing the matching standard letter
--       record_admission_form_fee()  bursar
--       record_admission_deposit()   bursar
--       set_admission_fee_amounts()  bursar
--   * 'tested' is reached automatically once English, Maths and CAT4 are
--     all in, and 'interviewed' once the interview is saved.
--   * Admissions data is children's personal data, often about families who
--     never join. Only people with /admissions (admissions, SMT, admin) can
--     read it. The bursar sees only what fees need, through
--     admission_fee_list().
--   * Changes and deletions of applicants, scores, CAT4 and interviews are
--     logged in change_history under a new area, 'admissions'. Actors are
--     stamped from auth.uid() by stamp_actor() or inside the functions.
--   * Letters are emailed through queue_workspace_email() with
--     email_reply_to('admissions'), a new email_reply_routes row that
--     replies to the member of staff who sent the letter. Parent-email
--     pauses (system_settings) are honoured.

set local formwork.change_note = 'Principal (direct)';

-- 1. Academic years ----------------------------------------------------------

create table if not exists public.academic_years (
  academic_year_id integer generated always as identity primary key,
  label text not null unique check (label ~ '^\d{4}/\d{2}$'),
  start_date date not null,
  end_date date not null,
  status text not null default 'planning' check (status in ('planning', 'current', 'closed')),
  admission_form_fee numeric(12,2) check (admission_form_fee >= 0),
  admission_deposit numeric(12,2) check (admission_deposit >= 0),
  admission_pass_mark numeric(5,2) not null default 50 check (admission_pass_mark between 0 and 100),
  constraint academic_years_dates check (start_date < end_date)
);

create unique index if not exists academic_years_one_current
  on public.academic_years ((true)) where status = 'current';

comment on table public.academic_years is
  'School years (migration 256). Exactly one is current. Holds the admission form fee, deposit and pass mark for entry in that year.';

alter table public.academic_years enable row level security;
grant select, insert, update, delete on public.academic_years to authenticated;

create policy "Academic years readable by all authenticated"
  on public.academic_years for select to authenticated using (true);
create policy "Academic years writable by admin"
  on public.academic_years for all to authenticated
  using (is_admin()) with check (is_admin());

insert into public.academic_years (label, start_date, end_date, status) values
  ('2026/27', '2026-09-01', '2027-08-31', 'current'),
  ('2027/28', '2027-09-01', '2028-08-31', 'planning')
on conflict (label) do nothing;

alter table public.terms
  add column if not exists academic_year_id integer references public.academic_years(academic_year_id);

update public.terms t
   set academic_year_id = ay.academic_year_id
  from public.academic_years ay
 where t.academic_year_id is null
   and t.start_date between ay.start_date and ay.end_date;

create or replace function public.fill_term_academic_year()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.academic_year_id is null then
    select ay.academic_year_id into new.academic_year_id
      from academic_years ay
     where new.start_date between ay.start_date and ay.end_date;
  end if;
  return new;
end;
$$;

revoke execute on function public.fill_term_academic_year() from public, anon, authenticated;

drop trigger if exists trg_fill_term_academic_year on public.terms;
create trigger trg_fill_term_academic_year
  before insert or update of start_date, academic_year_id on public.terms
  for each row execute function public.fill_term_academic_year();

-- 2. Previous schools --------------------------------------------------------

create table if not exists public.previous_schools (
  school_id integer generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  town text,
  state text,
  country text not null default 'Nigeria',
  curriculum text check (curriculum in ('British', 'Nigerian', 'American', 'IB', 'Other')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists previous_schools_name_town
  on public.previous_schools (lower(btrim(name)), lower(btrim(coalesce(town, ''))));

comment on table public.previous_schools is
  'Schools applicants come from (migration 256), one row per school so feeder schools can be counted. Edited at /admissions/schools.';

alter table public.previous_schools enable row level security;
grant select, insert, update, delete on public.previous_schools to authenticated;

create policy "Previous schools readable by admissions"
  on public.previous_schools for select to authenticated
  using (has_resource_access('/admissions'));
create policy "Previous schools added by admissions"
  on public.previous_schools for insert to authenticated
  with check (has_resource_access('/admissions'));
create policy "Previous schools edited on the schools page"
  on public.previous_schools for update to authenticated
  using (has_resource_access('/admissions/schools'))
  with check (has_resource_access('/admissions/schools'));
create policy "Unused previous schools deleted on the schools page"
  on public.previous_schools for delete to authenticated
  using (has_resource_access('/admissions/schools'));

create trigger trg_stamp_created_by before insert on public.previous_schools
  for each row execute function public.stamp_actor('created_by');

-- 3. Test days and papers ----------------------------------------------------

create table if not exists public.admission_sessions (
  session_id integer generated always as identity primary key,
  academic_year_id integer not null references public.academic_years(academic_year_id),
  session_date date not null,
  start_time time,
  venue text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

comment on table public.admission_sessions is
  'Admission test days (migration 256), for one entry year. Applicants are booked onto one by book_admission_test().';

create table if not exists public.admission_papers (
  paper_id integer generated always as identity primary key,
  academic_year_id integer not null references public.academic_years(academic_year_id),
  year_group integer not null check (year_group between 7 and 12),
  subject text not null check (subject in ('english', 'maths')),
  paper_name text,
  max_score numeric(6,2) not null check (max_score > 0),
  unique (academic_year_id, year_group, subject)
);

comment on table public.admission_papers is
  'The English and Maths entrance paper for each year group and entry year (migration 256). max_score turns a mark into a percentage.';

alter table public.admission_sessions enable row level security;
grant select, insert, update, delete on public.admission_sessions to authenticated;
alter table public.admission_papers enable row level security;
grant select, insert, update, delete on public.admission_papers to authenticated;

create policy "Admission sessions readable by admissions"
  on public.admission_sessions for select to authenticated
  using (has_resource_access('/admissions'));
create policy "Admission sessions written on the test days page"
  on public.admission_sessions for all to authenticated
  using (has_resource_access('/admissions/sessions'))
  with check (has_resource_access('/admissions/sessions'));

create policy "Admission papers readable by admissions"
  on public.admission_papers for select to authenticated
  using (has_resource_access('/admissions'));
create policy "Admission papers written on the papers page"
  on public.admission_papers for all to authenticated
  using (has_resource_access('/admissions/papers'))
  with check (has_resource_access('/admissions/papers'));

create trigger trg_stamp_created_by before insert on public.admission_sessions
  for each row execute function public.stamp_actor('created_by');

-- 4. Applicants and their families -------------------------------------------

create table if not exists public.applicants (
  applicant_id bigint generated always as identity primary key,
  first_name text not null check (btrim(first_name) <> ''),
  middle_name text,
  last_name text not null check (btrim(last_name) <> ''),
  preferred_name text,
  dob date,
  gender text,
  nationality text,
  entry_academic_year_id integer not null references public.academic_years(academic_year_id),
  entry_year_group integer not null check (entry_year_group between 7 and 12),
  previous_school_id integer references public.previous_schools(school_id),
  previous_school_year text,
  sibling_student_id integer references public.students(student_id),
  heard_about_us text,
  notes text,
  application_date date not null default school_today(),
  status text not null default 'enquiry' check (status in (
    'enquiry', 'form_paid', 'test_booked', 'tested', 'invited_to_interview',
    'interviewed', 'waitlisted', 'rejected', 'offered', 'accepted',
    'deposit_paid', 'enrolled', 'withdrawn')),
  -- Set only by the functions below (see applicants_guard()).
  form_fee_paid_on date,
  form_fee_amount numeric(12,2),
  form_fee_receipt text,
  form_fee_recorded_by uuid,
  session_id integer references public.admission_sessions(session_id),
  interview_at timestamptz,
  decision_notes text,
  decided_by uuid,
  decided_at timestamptz,
  accepted_at timestamptz,
  deposit_paid_on date,
  deposit_amount numeric(12,2),
  deposit_receipt text,
  deposit_recorded_by uuid,
  withdrawn_reason text,
  student_id integer references public.students(student_id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists applicants_entry on public.applicants (entry_academic_year_id, entry_year_group, status);

comment on table public.applicants is
  'Admissions applicants (migration 256). Status, fee, deposit and decision fields are changed only by the admissions and bursar functions; see applicants_guard().';

create table if not exists public.applicant_contacts (
  contact_id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(applicant_id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  relationship text,
  email text,
  phone text,
  is_primary boolean not null default false,
  parent_id integer references public.parents(parent_id)
);

create unique index if not exists applicant_contacts_one_primary
  on public.applicant_contacts (applicant_id) where is_primary;

comment on table public.applicant_contacts is
  'Parents and guardians of an applicant (migration 256). The primary contact receives the letters. parent_id is set when the family is already at the school.';

alter table public.applicants enable row level security;
grant select, insert, update, delete on public.applicants to authenticated;
alter table public.applicant_contacts enable row level security;
grant select, insert, update, delete on public.applicant_contacts to authenticated;

create policy "Applicants readable by admissions"
  on public.applicants for select to authenticated
  using (has_resource_access('/admissions'));
-- A new application always starts as an enquiry with nothing paid or
-- decided; applicants_guard() enforces the rest.
create policy "Applicants added by admissions"
  on public.applicants for insert to authenticated
  with check (has_resource_access('/admissions') and status = 'enquiry');
create policy "Applicants edited by admissions"
  on public.applicants for update to authenticated
  using (has_resource_access('/admissions'))
  with check (has_resource_access('/admissions'));
-- Only an unpaid enquiry can be deleted (a mistake or a duplicate). Once
-- money or a decision is involved the record stays; withdraw it instead.
create policy "Unpaid enquiries deleted by admissions"
  on public.applicants for delete to authenticated
  using (has_resource_access('/admissions') and (status = 'enquiry' or is_admin()));

create policy "Applicant contacts readable by admissions"
  on public.applicant_contacts for select to authenticated
  using (has_resource_access('/admissions'));
create policy "Applicant contacts written by admissions"
  on public.applicant_contacts for all to authenticated
  using (has_resource_access('/admissions'))
  with check (has_resource_access('/admissions'));

create trigger trg_stamp_created_by before insert on public.applicants
  for each row execute function public.stamp_actor('created_by');

drop trigger if exists trg_applicants_updated_at on public.applicants;
create trigger trg_applicants_updated_at before update on public.applicants
  for each row execute function public.set_updated_at();

create or replace function public.applicants_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- The functions below run as their owner, and the SQL editor as postgres;
  -- only requests from the app arrive as 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'enquiry'
       or new.form_fee_paid_on is not null or new.form_fee_amount is not null
       or new.form_fee_receipt is not null or new.form_fee_recorded_by is not null
       or new.session_id is not null or new.interview_at is not null
       or new.decided_by is not null or new.decided_at is not null or new.decision_notes is not null
       or new.accepted_at is not null
       or new.deposit_paid_on is not null or new.deposit_amount is not null
       or new.deposit_receipt is not null or new.deposit_recorded_by is not null
       or new.withdrawn_reason is not null or new.student_id is not null then
      raise exception 'A new application starts as an enquiry, with nothing paid, booked or decided.';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     or new.form_fee_paid_on is distinct from old.form_fee_paid_on
     or new.form_fee_amount is distinct from old.form_fee_amount
     or new.form_fee_receipt is distinct from old.form_fee_receipt
     or new.form_fee_recorded_by is distinct from old.form_fee_recorded_by
     or new.session_id is distinct from old.session_id
     or new.interview_at is distinct from old.interview_at
     or new.decision_notes is distinct from old.decision_notes
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.accepted_at is distinct from old.accepted_at
     or new.deposit_paid_on is distinct from old.deposit_paid_on
     or new.deposit_amount is distinct from old.deposit_amount
     or new.deposit_receipt is distinct from old.deposit_receipt
     or new.deposit_recorded_by is distinct from old.deposit_recorded_by
     or new.withdrawn_reason is distinct from old.withdrawn_reason
     or new.student_id is distinct from old.student_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.entry_academic_year_id is distinct from old.entry_academic_year_id and old.status <> 'enquiry'
     or new.entry_year_group is distinct from old.entry_year_group and old.session_id is not null then
    raise exception 'Status, test date, fees, deposit and decisions are changed with the buttons on the applicant''s page, not by editing the record.';
  end if;
  return new;
end;
$$;

revoke execute on function public.applicants_guard() from public, anon, authenticated;

drop trigger if exists trg_applicants_guard on public.applicants;
create trigger trg_applicants_guard before insert or update on public.applicants
  for each row execute function public.applicants_guard();

-- 5. Results: English, Maths, CAT4, interview --------------------------------

create table if not exists public.admission_test_scores (
  applicant_id bigint not null references public.applicants(applicant_id) on delete cascade,
  paper_id integer not null references public.admission_papers(paper_id),
  score numeric(6,2) not null check (score >= 0),
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now(),
  primary key (applicant_id, paper_id)
);

create table if not exists public.admission_cat4 (
  applicant_id bigint primary key references public.applicants(applicant_id) on delete cascade,
  test_date date,
  level text,
  verbal_sas numeric(5,1),
  quantitative_sas numeric(5,1),
  non_verbal_sas numeric(5,1),
  spatial_sas numeric(5,1),
  mean_sas numeric(5,1),
  profile text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now()
);

comment on table public.admission_cat4 is
  'An applicant''s CAT4 scores (migration 256), the same shape as cat4_results so they can be copied across when the applicant is enrolled.';

create table if not exists public.applicant_interviews (
  applicant_id bigint primary key references public.applicants(applicant_id) on delete cascade,
  interviewed_on date not null default school_today(),
  interviewer_staff_id integer references public.staff(staff_id),
  reading_age_months integer check (reading_age_months between 36 and 240),
  reading_test_name text,
  interests text[] not null default '{}',
  interests_other text,
  languages_spoken text,
  strengths text,
  concerns text,
  recommendation text check (recommendation in ('offer', 'waitlist', 'reject')),
  comments text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now()
);

comment on column public.applicant_interviews.reading_age_months is
  'Reading age in months from the school''s paper-based reading test, taken at the interview. Shown as years and months beside the child''s age on the day.';

alter table public.admission_test_scores enable row level security;
grant select, insert, update, delete on public.admission_test_scores to authenticated;
alter table public.admission_cat4 enable row level security;
grant select, insert, update, delete on public.admission_cat4 to authenticated;
alter table public.applicant_interviews enable row level security;
grant select, insert, update, delete on public.applicant_interviews to authenticated;

create policy "Admission scores readable and written by admissions"
  on public.admission_test_scores for all to authenticated
  using (has_resource_access('/admissions'))
  with check (has_resource_access('/admissions'));
create policy "Admission CAT4 readable and written by admissions"
  on public.admission_cat4 for all to authenticated
  using (has_resource_access('/admissions'))
  with check (has_resource_access('/admissions'));
create policy "Applicant interviews readable and written by admissions"
  on public.applicant_interviews for all to authenticated
  using (has_resource_access('/admissions'))
  with check (has_resource_access('/admissions'));

create trigger trg_stamp_entered_by before insert or update on public.admission_test_scores
  for each row execute function public.stamp_actor('entered_by');
create trigger trg_stamp_entered_by before insert or update on public.admission_cat4
  for each row execute function public.stamp_actor('entered_by');
create trigger trg_stamp_entered_by before insert or update on public.applicant_interviews
  for each row execute function public.stamp_actor('entered_by');

-- A score only counts against the paper for the applicant's own entry year
-- and year group.
create or replace function public.check_admission_score_paper()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ok boolean;
  v_max numeric;
begin
  select (p.academic_year_id = a.entry_academic_year_id and p.year_group = a.entry_year_group), p.max_score
    into v_ok, v_max
    from admission_papers p, applicants a
   where p.paper_id = new.paper_id and a.applicant_id = new.applicant_id;
  if not coalesce(v_ok, false) then
    raise exception 'That paper is not the one for this applicant''s entry year and year group.';
  end if;
  if new.score > v_max then
    raise exception 'A score of % is more than the paper''s maximum of %.', new.score, v_max;
  end if;
  return new;
end;
$$;

revoke execute on function public.check_admission_score_paper() from public, anon, authenticated;

create trigger trg_check_admission_score_paper before insert or update on public.admission_test_scores
  for each row execute function public.check_admission_score_paper();

create or replace view public.applicant_test_summary
with (security_invoker = true) as
select
  a.applicant_id,
  round(100 * e.score / pe.max_score, 1) as english_pct,
  round(100 * m.score / pm.max_score, 1) as maths_pct,
  case when e.score is not null and m.score is not null
       then round((100 * e.score / pe.max_score + 100 * m.score / pm.max_score) / 2, 1) end as average_pct,
  ay.admission_pass_mark as pass_mark,
  case when e.score is not null and m.score is not null
       then (100 * e.score / pe.max_score + 100 * m.score / pm.max_score) / 2 >= ay.admission_pass_mark end as passed,
  c.mean_sas,
  (e.score is not null and m.score is not null and c.applicant_id is not null) as complete
from applicants a
join academic_years ay on ay.academic_year_id = a.entry_academic_year_id
left join admission_papers pe on pe.academic_year_id = a.entry_academic_year_id
  and pe.year_group = a.entry_year_group and pe.subject = 'english'
left join admission_test_scores e on e.applicant_id = a.applicant_id and e.paper_id = pe.paper_id
left join admission_papers pm on pm.academic_year_id = a.entry_academic_year_id
  and pm.year_group = a.entry_year_group and pm.subject = 'maths'
left join admission_test_scores m on m.applicant_id = a.applicant_id and m.paper_id = pm.paper_id
left join admission_cat4 c on c.applicant_id = a.applicant_id;

comment on view public.applicant_test_summary is
  'English and Maths as percentages, their average, and whether it reaches the entry year''s pass mark (50% as agreed). complete = English, Maths and CAT4 all entered.';

grant select on public.applicant_test_summary to authenticated;

-- 'tested' once English, Maths and CAT4 are all in; 'interviewed' once the
-- interview is saved. Only moves forward from the stage just before.
create or replace function public.advance_applicant_on_results()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id bigint := new.applicant_id;
begin
  if tg_table_name = 'applicant_interviews' then
    update applicants set status = 'interviewed'
     where applicant_id = v_id and status = 'invited_to_interview';
  elsif exists (select 1 from applicant_test_summary s where s.applicant_id = v_id and s.complete) then
    update applicants set status = 'tested'
     where applicant_id = v_id and status = 'test_booked';
  end if;
  return new;
end;
$$;

revoke execute on function public.advance_applicant_on_results() from public, anon, authenticated;

create trigger trg_advance_applicant after insert or update on public.admission_test_scores
  for each row execute function public.advance_applicant_on_results();
create trigger trg_advance_applicant after insert or update on public.admission_cat4
  for each row execute function public.advance_applicant_on_results();
create trigger trg_advance_applicant after insert on public.applicant_interviews
  for each row execute function public.advance_applicant_on_results();

-- 6. Standard letters --------------------------------------------------------

create table if not exists public.admission_letter_templates (
  letter_kind text primary key check (letter_kind in (
    'test_date', 'invite_to_interview', 'waitlist_after_test', 'reject_after_test',
    'offer', 'waitlist_after_interview', 'reject_after_interview')),
  label text not null,
  sort_order integer not null,
  subject text,
  body text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.admission_letter_templates is
  'The school''s standard admissions letters (migration 256), edited at /admissions/letters. Plain text with {{merge_fields}}. Empty until the school''s wording is entered; a decision with no letter set up goes through without one.';

insert into public.admission_letter_templates (letter_kind, label, sort_order) values
  ('test_date',                'Test date',                          10),
  ('invite_to_interview',      'Invitation to interview',            20),
  ('waitlist_after_test',      'Waiting list (after the test)',      30),
  ('reject_after_test',        'Unsuccessful (after the test)',      40),
  ('offer',                    'Offer of a place',                   50),
  ('waitlist_after_interview', 'Waiting list (after the interview)', 60),
  ('reject_after_interview',   'Unsuccessful (after the interview)', 70)
on conflict (letter_kind) do nothing;

create table if not exists public.applicant_letters (
  letter_id bigint generated always as identity primary key,
  applicant_id bigint not null references public.applicants(applicant_id) on delete cascade,
  letter_kind text not null references public.admission_letter_templates(letter_kind),
  subject text not null,
  body text not null,
  sent_by uuid,
  sent_at timestamptz not null default now(),
  emailed_to text,
  email_id bigint
);

comment on table public.applicant_letters is
  'Every admissions letter exactly as it was produced (migration 256). Written only by the admissions functions; the PDF is drawn from body.';

alter table public.admission_letter_templates enable row level security;
grant select, update on public.admission_letter_templates to authenticated;
alter table public.applicant_letters enable row level security;
grant select on public.applicant_letters to authenticated;

create policy "Letter templates readable by admissions"
  on public.admission_letter_templates for select to authenticated
  using (has_resource_access('/admissions'));
create policy "Letter templates edited on the letters page"
  on public.admission_letter_templates for update to authenticated
  using (has_resource_access('/admissions/letters'))
  with check (has_resource_access('/admissions/letters'));

create policy "Applicant letters readable by admissions"
  on public.applicant_letters for select to authenticated
  using (has_resource_access('/admissions'));

create trigger trg_stamp_updated_by before update on public.admission_letter_templates
  for each row execute function public.stamp_actor('updated_by');
drop trigger if exists trg_letter_templates_updated_at on public.admission_letter_templates;
create trigger trg_letter_templates_updated_at before update on public.admission_letter_templates
  for each row execute function public.set_updated_at();

insert into public.email_reply_routes
  (email_kind, sort_order, label, description, sender_label, reply_to_sender, reply_to_smt, addresses)
values
  ('admissions', 70, 'Admissions letters',
   'Test dates, interview invitations, offers and other standard letters to applicants'' families.',
   'The member of staff who sent the letter', true, false, '{}')
on conflict (email_kind) do nothing;

-- Merge a template for one applicant. Plain text in, plain text out.
create or replace function public.render_admission_letter(p_applicant_id bigint, p_kind text)
returns table (subject text, body text, email text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a applicants;
  t admission_letter_templates;
  v_contact applicant_contacts;
  v_session admission_sessions;
  v_year academic_years;
  v_fields jsonb;
  v_key text;
begin
  if not has_resource_access('/admissions') then
    raise exception 'Only admissions staff can produce admissions letters.';
  end if;

  select * into a from applicants where applicant_id = p_applicant_id;
  select * into t from admission_letter_templates where letter_kind = p_kind;
  if a.applicant_id is null or t.letter_kind is null then
    return;
  end if;
  if coalesce(btrim(t.body), '') = '' then
    return;
  end if;

  select * into v_contact from applicant_contacts c
   where c.applicant_id = p_applicant_id
   order by c.is_primary desc, c.contact_id limit 1;
  select * into v_session from admission_sessions where session_id = a.session_id;
  select * into v_year from academic_years where academic_year_id = a.entry_academic_year_id;

  v_fields := jsonb_build_object(
    'child_first_name', coalesce(nullif(a.preferred_name, ''), a.first_name),
    'child_full_name', concat_ws(' ', a.first_name, nullif(a.middle_name, ''), a.last_name),
    'parent_name', coalesce(v_contact.name, 'Parent/Guardian'),
    'entry_year', v_year.label,
    'year_group', 'Year ' || a.entry_year_group,
    'test_date', coalesce(to_char(v_session.session_date, 'FMDay FMDD FMMonth YYYY'), ''),
    'test_time', coalesce(to_char(v_session.start_time, 'FMHH12:MI am'), ''),
    'test_venue', coalesce(v_session.venue, ''),
    'interview_date', coalesce(to_char(a.interview_at at time zone 'Africa/Lagos', 'FMDay FMDD FMMonth YYYY'), ''),
    'interview_time', coalesce(to_char(a.interview_at at time zone 'Africa/Lagos', 'FMHH12:MI am'), ''),
    'form_fee', coalesce(to_char(v_year.admission_form_fee, 'FM999,999,990.00'), ''),
    'deposit', coalesce(to_char(v_year.admission_deposit, 'FM999,999,990.00'), ''),
    'today', to_char(school_today(), 'FMDD FMMonth YYYY'));

  subject := coalesce(nullif(btrim(t.subject), ''), t.label);
  body := t.body;
  for v_key in select jsonb_object_keys(v_fields) loop
    subject := replace(subject, '{{' || v_key || '}}', v_fields->>v_key);
    body := replace(body, '{{' || v_key || '}}', v_fields->>v_key);
  end loop;
  email := case when is_plain_email(lower(btrim(v_contact.email))) then lower(btrim(v_contact.email)) end;
  return next;
end;
$$;

-- Produce, keep and (optionally) email one letter. Internal: called only by
-- the decision functions below, which have already checked the caller.
create or replace function public.issue_admission_letter(p_applicant_id bigint, p_kind text, p_send_email boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  r record;
  v_letter_id bigint;
  v_email_id bigint;
  v_html text;
  v_note text;
begin
  select * into r from render_admission_letter(p_applicant_id, p_kind);
  if r.body is null then
    return jsonb_build_object('letter_id', null, 'note', 'No standard letter is set up for this step yet, so none was produced.');
  end if;

  if p_send_email and r.email is not null and not parent_emails_paused() then
    v_html := '<p>' || replace(replace(
                replace(replace(replace(r.body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                E'\n\n', '</p><p>'), E'\n', '<br>') || '</p>';
    v_email_id := queue_workspace_email(jsonb_build_object(
      'to', r.email,
      'subject', r.subject,
      'html', v_html,
      'reply_to', email_reply_to('admissions')));
  elsif p_send_email and r.email is null then
    v_note := 'Not emailed: the main contact has no usable email address. Print the letter instead.';
  elsif p_send_email then
    v_note := 'Not emailed: emails to parents are paused. Print the letter instead.';
  end if;

  insert into applicant_letters (applicant_id, letter_kind, subject, body, sent_by, emailed_to, email_id)
  values (p_applicant_id, p_kind, r.subject, r.body, auth.uid(),
          case when v_email_id is not null then r.email end, v_email_id)
  returning letter_id into v_letter_id;

  return jsonb_build_object('letter_id', v_letter_id, 'emailed_to',
                            case when v_email_id is not null then r.email end, 'note', v_note);
end;
$$;

revoke execute on function public.issue_admission_letter(bigint, text, boolean) from public, anon, authenticated;

-- 7. Moving an applicant along ------------------------------------------------

create or replace function public.book_admission_test(p_applicant_id bigint, p_session_id integer, p_send_email boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a applicants;
  s admission_sessions;
begin
  if not has_resource_access('/admissions') then
    raise exception 'Only admissions staff can book test dates.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  select * into s from admission_sessions where session_id = p_session_id;
  if a.applicant_id is null or s.session_id is null then
    raise exception 'Applicant or test day not found.';
  end if;
  if a.status not in ('form_paid', 'test_booked') then
    raise exception 'A test date can only be fixed once the admission form is paid for, and before the test has been sat (status now: %).', a.status;
  end if;
  if s.academic_year_id <> a.entry_academic_year_id then
    raise exception 'That test day is for a different entry year.';
  end if;

  update applicants set session_id = p_session_id, status = 'test_booked'
   where applicant_id = p_applicant_id;

  return jsonb_build_object('status', 'test_booked')
         || issue_admission_letter(p_applicant_id, 'test_date', p_send_email);
end;
$$;

-- Every other move an admissions officer makes. The allowed moves follow
-- the school's process; an admin can move an applicant anywhere except to
-- the statuses owned by the bursar or by enrolment.
create or replace function public.post_admission_decision(
  p_applicant_id bigint,
  p_status text,
  p_notes text default null,
  p_interview_at timestamptz default null,
  p_send_email boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a applicants;
  v_allowed text[];
  v_kind text;
  v_interviewed boolean;
begin
  if not has_resource_access('/admissions') then
    raise exception 'Only admissions staff can change an applicant''s status.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  if a.applicant_id is null then
    raise exception 'Applicant not found.';
  end if;
  if p_status in ('form_paid', 'deposit_paid', 'test_booked', 'enrolled', 'enquiry') then
    raise exception 'That step is recorded elsewhere (the bursar records payments; test dates are booked on the test day).';
  end if;

  v_allowed := case a.status
    when 'enquiry'              then array['withdrawn']
    when 'form_paid'            then array['withdrawn']
    when 'test_booked'          then array['tested', 'withdrawn']
    when 'tested'               then array['invited_to_interview', 'waitlisted', 'rejected', 'withdrawn']
    when 'invited_to_interview' then array['interviewed', 'rejected', 'withdrawn']
    when 'interviewed'          then array['offered', 'waitlisted', 'rejected', 'withdrawn']
    when 'waitlisted'           then array['invited_to_interview', 'offered', 'rejected', 'withdrawn']
    when 'offered'              then array['accepted', 'withdrawn']
    when 'accepted'             then array['withdrawn']
    when 'deposit_paid'         then array['withdrawn']
    else array[]::text[]
  end;
  if not (p_status = any (v_allowed) or is_admin()) then
    raise exception 'An applicant who is % can''t be moved to %.', replace(a.status, '_', ' '), replace(p_status, '_', ' ');
  end if;
  if p_status = 'invited_to_interview' and p_interview_at is null then
    raise exception 'Give the interview date and time.';
  end if;
  if p_status = 'withdrawn' and coalesce(btrim(p_notes), '') = '' then
    raise exception 'Say why the application was withdrawn.';
  end if;

  -- Which standard letter goes with this move. Waiting list and rejection
  -- letters depend on whether the child has had the interview yet.
  v_interviewed := exists (select 1 from applicant_interviews i where i.applicant_id = a.applicant_id);
  v_kind := case
    when p_status = 'invited_to_interview' then 'invite_to_interview'
    when p_status = 'offered' then 'offer'
    when p_status = 'waitlisted' and v_interviewed then 'waitlist_after_interview'
    when p_status = 'waitlisted' then 'waitlist_after_test'
    when p_status = 'rejected' and v_interviewed then 'reject_after_interview'
    when p_status = 'rejected' then 'reject_after_test'
  end;

  update applicants set
    status = p_status,
    interview_at = case when p_status = 'invited_to_interview' then p_interview_at else interview_at end,
    decision_notes = case when p_status in ('invited_to_interview', 'waitlisted', 'rejected', 'offered')
                          then nullif(btrim(p_notes), '') else decision_notes end,
    decided_by = case when p_status in ('invited_to_interview', 'waitlisted', 'rejected', 'offered')
                      then auth.uid() else decided_by end,
    decided_at = case when p_status in ('invited_to_interview', 'waitlisted', 'rejected', 'offered')
                      then now() else decided_at end,
    accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
    withdrawn_reason = case when p_status = 'withdrawn' then btrim(p_notes) else withdrawn_reason end
  where applicant_id = p_applicant_id;

  if v_kind is null then
    return jsonb_build_object('status', p_status);
  end if;
  return jsonb_build_object('status', p_status)
         || issue_admission_letter(p_applicant_id, v_kind, p_send_email);
end;
$$;

-- 8. The bursar: form fee, deposit, amounts ----------------------------------

create or replace function public.record_admission_form_fee(p_applicant_id bigint, p_paid_on date, p_receipt text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a applicants;
  v_fee numeric;
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can record admission form payments.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  if a.applicant_id is null then
    raise exception 'Applicant not found.';
  end if;
  if a.status in ('withdrawn') then
    raise exception 'This application has been withdrawn.';
  end if;
  if p_paid_on is null or p_paid_on > school_today() then
    raise exception 'Give the date the form was paid for (not in the future).';
  end if;
  select admission_form_fee into v_fee from academic_years where academic_year_id = a.entry_academic_year_id;
  if v_fee is null then
    raise exception 'Set the admission form fee for this entry year first.';
  end if;

  update applicants set
    form_fee_paid_on = p_paid_on,
    form_fee_amount = coalesce(a.form_fee_amount, v_fee),
    form_fee_receipt = nullif(btrim(p_receipt), ''),
    form_fee_recorded_by = auth.uid(),
    status = case when a.status = 'enquiry' then 'form_paid' else a.status end
  where applicant_id = p_applicant_id;
end;
$$;

create or replace function public.record_admission_deposit(p_applicant_id bigint, p_paid_on date, p_amount numeric, p_receipt text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a applicants;
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can record deposits.';
  end if;
  select * into a from applicants where applicant_id = p_applicant_id for update;
  if a.applicant_id is null then
    raise exception 'Applicant not found.';
  end if;
  if a.status not in ('accepted', 'deposit_paid') then
    raise exception 'A deposit is recorded once the family has accepted the offer (status now: %).', replace(a.status, '_', ' ');
  end if;
  if p_paid_on is null or p_paid_on > school_today() then
    raise exception 'Give the date the deposit was paid (not in the future).';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Give the amount paid.';
  end if;

  update applicants set
    deposit_paid_on = p_paid_on,
    deposit_amount = p_amount,
    deposit_receipt = nullif(btrim(p_receipt), ''),
    deposit_recorded_by = auth.uid(),
    status = 'deposit_paid'
  where applicant_id = p_applicant_id;
end;
$$;

create or replace function public.set_admission_fee_amounts(p_academic_year_id integer, p_form_fee numeric, p_deposit numeric)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not user_has_staff_role(array['bursar']) then
    raise exception 'Only the bursar can set admission fees.';
  end if;
  if p_form_fee < 0 or p_deposit < 0 then
    raise exception 'Amounts can''t be negative.';
  end if;
  update academic_years
     set admission_form_fee = p_form_fee, admission_deposit = p_deposit
   where academic_year_id = p_academic_year_id;
end;
$$;

-- What the bursar needs, and nothing else: no scores, interview or notes.
create or replace function public.admission_fee_list(p_academic_year_id integer)
returns table (
  applicant_id bigint, child_name text, entry_year_group integer, status text,
  contact_name text, contact_phone text, contact_email text,
  form_fee_paid_on date, form_fee_amount numeric, form_fee_receipt text,
  accepted_at timestamptz,
  deposit_paid_on date, deposit_amount numeric, deposit_receipt text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (user_has_staff_role(array['bursar']) or has_resource_access('/admissions')) then
    raise exception 'Only the bursar and admissions staff can see admission payments.';
  end if;
  return query
  select a.applicant_id,
         concat_ws(' ', a.first_name, a.last_name),
         a.entry_year_group, a.status,
         c.name, c.phone, c.email,
         a.form_fee_paid_on, a.form_fee_amount, a.form_fee_receipt,
         a.accepted_at,
         a.deposit_paid_on, a.deposit_amount, a.deposit_receipt
    from applicants a
    left join lateral (
      select * from applicant_contacts ac
       where ac.applicant_id = a.applicant_id
       order by ac.is_primary desc, ac.contact_id limit 1) c on true
   where a.entry_academic_year_id = p_academic_year_id
   order by a.last_name, a.first_name;
end;
$$;

-- 9. Merging duplicate previous schools ---------------------------------------

create or replace function public.merge_previous_schools(p_from integer, p_into integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admissions/schools') then
    raise exception 'Only admissions staff can merge schools.';
  end if;
  if p_from = p_into then
    raise exception 'Choose two different schools.';
  end if;
  if not exists (select 1 from previous_schools where school_id = p_into) then
    raise exception 'School not found.';
  end if;
  update applicants set previous_school_id = p_into where previous_school_id = p_from;
  delete from previous_schools where school_id = p_from;
end;
$$;

-- 10. History, pages and permissions ------------------------------------------

alter table public.change_history drop constraint if exists change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions'));

create trigger trg_log_change after update or delete on public.applicants
  for each row execute function public.log_change('admissions', 'applicant_id');
create trigger trg_log_change after update or delete on public.admission_test_scores
  for each row execute function public.log_change('admissions', 'applicant_id,paper_id');
create trigger trg_log_change after update or delete on public.admission_cat4
  for each row execute function public.log_change('admissions', 'applicant_id');
create trigger trg_log_change after update or delete on public.applicant_interviews
  for each row execute function public.log_change('admissions', 'applicant_id');
create trigger trg_log_change after insert or update or delete on public.admission_letter_templates
  for each row execute function public.log_change('admissions', 'letter_kind');

insert into resources (resource_key, label, section, sort_order) values
  ('/admissions',                'Applicants',          'Admissions', 10),
  ('/admissions/sessions',       'Test Days',           'Admissions', 20),
  ('/admissions/papers',         'Test Papers',         'Admissions', 30),
  ('/admissions/letters',        'Standard Letters',    'Admissions', 40),
  ('/admissions/schools',        'Previous Schools',    'Admissions', 50),
  ('/bursar/admission-forms',    'Admission Payments',  'Fees & Bills', 85)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('admissions', '/admissions'),
  ('admissions', '/admissions/sessions'),
  ('admissions', '/admissions/papers'),
  ('admissions', '/admissions/letters'),
  ('admissions', '/admissions/schools'),
  ('smt',        '/admissions'),
  ('smt',        '/admissions/sessions'),
  ('smt',        '/admissions/papers'),
  ('smt',        '/admissions/letters'),
  ('smt',        '/admissions/schools'),
  ('bursar',     '/bursar/admission-forms')
on conflict do nothing;
