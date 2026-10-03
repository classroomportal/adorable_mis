-- Migration 324: parents see their children's reading ages; teachers record
-- reading tests.
--
-- Why (the principal, 2 Oct 2026, after migration 323):
--   * "Parents only": parents should see reading ages; students still don't.
--   * Teachers do the testing, so the teacher role gets
--     /reading-ages/record (it can still be taken away at /admin/permissions).
--
-- Now:
--   1. reading_age_history() still returns everything to staff. For anyone
--      else it returns only children in my_current_child_ids(): the parent's
--      own children who are still at the school (migration 255's rule), so a
--      leaver's readings disappear from the portal like the rest of their
--      record. A student login (no parent_id) gets nothing. The parent sees
--      the same rows as staff: date, test name, reading age, age on the day
--      and the gap. The interview reading is their own child's, so it stays
--      in; nothing else from the interview is passed on.
--   2. No parent policy on reading_age_tests itself: the portal reads through
--      the function only.
--   3. teacher gets /reading-ages/record.

set local formwork.change_note = 'Principal (direct)';

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
   where (p_student_ids is null or r.student_id = any (p_student_ids))
     and (v_staff or r.student_id = any (v_children))
   order by r.student_id, r.tested_on, r.source;
end;
$$;

revoke execute on function public.reading_age_history(integer[]) from public, anon;
grant execute on function public.reading_age_history(integer[]) to authenticated;

insert into public.role_permissions (role_name, resource_key)
values ('teacher', '/reading-ages/record')
on conflict do nothing;
