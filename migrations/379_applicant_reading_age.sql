-- Migration 379: record a reading age on the application itself.
--
-- Why (the principal, 6 Oct 2026): "When we have a new applicant the reading
-- age needs to be recorded then." Until now the only place for an
-- applicant's reading age was the interview (applicant_interviews,
-- migration 256), and the Interview section only appears once the child has
-- been invited to interview. A child tested when they apply had nowhere to
-- put it. The reading can't go in applicant_interviews early either: saving
-- an interview row moves the applicant on to Interviewed
-- (trg_advance_applicant), and an interview on record changes which letter
-- a later decision sends.
--
-- Now:
--   1. applicants gains reading_age_months (36 to 240, the same range as the
--      interview and the school's tests), reading_tested_on and
--      reading_test_name. A reading needs its date; the date can't be after
--      today (school_today(), checked by trigger since a check constraint
--      can't call it). Admissions staff fill them in on the New application
--      form and on the applicant's Details. They are ordinary applicant
--      fields: applicants_guard() doesn't touch them, and changes are logged
--      in change_history under 'admissions' like the rest of the record.
--   2. reading_age_history() reads them as a fourth source, 'application',
--      once the applicant is enrolled (applicants.student_id), in the same way
--      as the interview reading: only the reading, date and test name are
--      passed on. The interview reading is still read as before.

set local formwork.change_note = 'Principal (direct)';

alter table public.applicants
  add column reading_age_months integer,
  add column reading_tested_on date,
  add column reading_test_name text;

alter table public.applicants
  add constraint applicants_reading_age_range
    check (reading_age_months is null or reading_age_months between 36 and 240),
  add constraint applicants_reading_age_dated
    check (reading_age_months is null or reading_tested_on is not null);

create or replace function public.applicants_reading_date_check()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reading_tested_on is not null
     and new.reading_tested_on is distinct from (case when tg_op = 'UPDATE' then old.reading_tested_on end)
     and new.reading_tested_on > school_today() then
    raise exception 'A reading age can''t be dated after today.';
  end if;
  return new;
end;
$$;

create trigger trg_applicants_reading_date
  before insert or update of reading_tested_on on public.applicants
  for each row execute function public.applicants_reading_date_check();

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
declare
  v_staff boolean := is_staff_or_admin();
  v_children integer[];
begin
  if not v_staff then
    select coalesce(array_agg(c), '{}') into v_children from my_current_child_ids() c;
    if cardinality(v_children) = 0 then
      return;
    end if;
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
    union all
    select a.student_id, a.reading_tested_on, a.reading_age_months, 'application',
           coalesce(nullif(trim(a.reading_test_name), ''), 'Admissions application'), null::bigint
      from applicants a
     where a.student_id is not null and a.reading_age_months is not null
  )
  select r.student_id, r.tested_on, r.reading_age_months,
         age_m, r.reading_age_months - age_m, r.source, r.test_name, r.test_id
    from (select rd.*, count(*) filter (where rd.source <> 'ngrt') over (partition by rd.student_id) as n_readings
            from readings rd) r
    join students s on s.student_id = r.student_id
    cross join lateral (
      select case when s.dob is null then null
                  else (extract(year from age(r.tested_on, s.dob)) * 12
                        + extract(month from age(r.tested_on, s.dob)))::int end as age_m
    ) a
   where (p_student_ids is null or r.student_id = any (p_student_ids))
     and (v_staff or (r.student_id = any (v_children) and r.n_readings >= 2))
   order by r.student_id, r.tested_on, r.source;
end;
$$;

revoke execute on function public.reading_age_history(integer[]) from public, anon;
grant execute on function public.reading_age_history(integer[]) to authenticated;
