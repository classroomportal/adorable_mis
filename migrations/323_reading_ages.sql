-- Migration 323: reading ages, tested on entry and through school, tracked
-- against each child's age.
--
-- Why (the principal, 2 Oct 2026): "We need to track reading age. We test it
-- on entry and at other times. The date when we test needs to be recorded and
-- the gap between reading age and chronological age calculated and tracked.
-- We need to be able to see how this changes over time. We test on interview
-- and test several times after. Literacy is a key improvement target."
--
-- Until now a reading age could be in two places, neither of which followed a
-- child through school:
--   * applicant_interviews.reading_age_months (migration 256), the paper test
--     at the admissions interview, visible only to admissions;
--   * ngrt_results.reading_age, text "YY:MM" from the NGRT import, last
--     loaded in January 2023.
-- The school's own re-tests had nowhere to go at all.
--
-- Now:
--   1. reading_age_tests: one row per student per sitting: the date tested
--      (required, never in the future), the reading age in months (36 to 240,
--      the same range as the interview), the name of the test and a note.
--      One result per student, date and test.
--   2. reading_age_history(student_ids): every reading age a student has,
--      from all three places, oldest first, each with the child's age on the
--      day (whole months, from students.dob) and the gap (reading age minus
--      age: negative means reading below their age). The age and gap are
--      worked out when read, never stored, so correcting a date of birth
--      corrects every gap. The interview reading comes in through
--      applicants.student_id once an applicant is enrolled, and only the
--      reading age, date and test name are passed on: the rest of the
--      interview stays with admissions. All staff can call it (they can
--      already read NGRT); students and parents can't.
--   3. Two pages: /reading-ages, the tracker (teacher, head_of_department,
--      mentor, pastoral, assessment_manager, smt), and /reading-ages/record,
--      entering and correcting school tests (assessment_manager,
--      head_of_department, smt). Both can be changed at /admin/permissions;
--      admin always has both. All staff can read the table, as they can NGRT.
--   4. Entries are stamped with who entered them and logged in change_history
--      under a new area, 'reading_ages'.

set local formwork.change_note = 'Principal (direct)';

-- 1. The table ------------------------------------------------------------------------------
create table public.reading_age_tests (
  id bigint generated always as identity primary key,
  student_id integer not null references public.students(student_id),
  tested_on date not null,
  reading_age_months integer not null check (reading_age_months between 36 and 240),
  test_name text not null default 'School reading test' check (length(trim(test_name)) between 1 and 80),
  notes text,
  entered_by uuid default auth.uid(),
  entered_at timestamptz not null default now()
);

create unique index reading_age_tests_one_per_sitting
  on public.reading_age_tests (student_id, tested_on, test_name);
create index reading_age_tests_student_idx on public.reading_age_tests (student_id, tested_on);

alter table public.reading_age_tests enable row level security;
grant select, insert, update, delete on public.reading_age_tests to authenticated;

create policy staff_read_reading_age_tests on public.reading_age_tests
  for select using (is_staff_or_admin());

create policy record_reading_age_tests on public.reading_age_tests
  for all using (has_resource_access('/reading-ages/record'))
  with check (has_resource_access('/reading-ages/record'));

-- A test can't be dated after today (school time), and names are tidied.
create or replace function public.reading_age_tests_check()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tested_on > school_today() then
    raise exception 'A reading test can''t be dated after today.';
  end if;
  new.test_name := trim(regexp_replace(new.test_name, '\s+', ' ', 'g'));
  new.notes := nullif(trim(new.notes), '');
  return new;
end;
$$;

create trigger trg_reading_age_tests_check
  before insert or update on public.reading_age_tests
  for each row execute function public.reading_age_tests_check();

create trigger stamp_entered_by
  before insert or update on public.reading_age_tests
  for each row execute function public.stamp_actor('entered_by');

alter table public.change_history drop constraint if exists change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions', 'groups', 'students', 'reading_ages'));

create trigger trg_log_change
  after insert or update or delete on public.reading_age_tests
  for each row execute function public.log_change('reading_ages', 'id');

-- 2. Every reading age a student has --------------------------------------------------------
create or replace function public.reading_age_history(p_student_ids integer[] default null)
returns table (
  student_id integer,
  tested_on date,
  reading_age_months integer,
  age_months integer,
  gap_months integer,
  source text,
  test_name text,
  test_id bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not is_staff_or_admin() then
    raise exception 'Only staff can read reading ages.';
  end if;

  return query
  with readings as (
    select t.student_id, t.tested_on, t.reading_age_months, 'school'::text as source,
           t.test_name, t.id as test_id
      from reading_age_tests t
    union all
    select n.student_id, n.test_date,
           (m[1]::int * 12 + m[2]::int), 'ngrt', 'NGRT', null::bigint
      from ngrt_results n,
           regexp_match(n.reading_age, '^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$') m
     where n.test_date is not null and m is not null and m[2]::int < 12
    union all
    select a.student_id, i.interviewed_on, i.reading_age_months, 'interview',
           coalesce(nullif(trim(i.reading_test_name), ''), 'Admissions interview'), null::bigint
      from applicant_interviews i
      join applicants a on a.applicant_id = i.applicant_id
     where a.student_id is not null and i.reading_age_months is not null
  )
  select r.student_id, r.tested_on, r.reading_age_months,
         age_m, r.reading_age_months - age_m, r.source, r.test_name, r.test_id
    from readings r
    join students s on s.student_id = r.student_id
    cross join lateral (
      select case when s.dob is null then null
                  else (extract(year from age(r.tested_on, s.dob)) * 12
                        + extract(month from age(r.tested_on, s.dob)))::int end as age_m
    ) a
   where p_student_ids is null or r.student_id = any (p_student_ids)
   order by r.student_id, r.tested_on, r.source;
end;
$$;

revoke execute on function public.reading_age_history(integer[]) from public, anon;
grant execute on function public.reading_age_history(integer[]) to authenticated;

-- 3. The pages and who has them -------------------------------------------------------------
insert into public.resources (resource_key, label, section, sort_order) values
  ('/reading-ages', 'Reading Ages', 'Assessment', 68),
  ('/reading-ages/record', 'Record Reading Tests', 'Assessment', 69)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('teacher', '/reading-ages'),
  ('head_of_department', '/reading-ages'),
  ('mentor', '/reading-ages'),
  ('pastoral', '/reading-ages'),
  ('assessment_manager', '/reading-ages'),
  ('smt', '/reading-ages'),
  ('assessment_manager', '/reading-ages/record'),
  ('head_of_department', '/reading-ages/record'),
  ('smt', '/reading-ages/record')
on conflict do nothing;
