-- 213_birthdays.sql
--
-- Birthdays: a list of staff and students with a birthday in the next 7
-- days, under Pastoral (/pastoral/birthdays), and today's birthdays shown on
-- the welcome splash straight after sign-in.
--
-- Asked for 27 Sep 2026. Two things shaped it:
--
-- * Staff dates of birth live in staff_hr_profiles, which only HR and SMT
--   can read (migration 134) — it also holds police clearance and next of
--   kin. So the list comes from SECURITY DEFINER functions that hand back
--   the birthday only (day and month; never the year or age) and nothing
--   else from that table. Students get the age they turn on the day, which
--   the school wanted for cards and assemblies.
--
-- * "Flash on the login screen" became "flash straight after sign-in". The
--   login page is public, and a child's date of birth is a parent's first
--   password (migration 160), so today's names must not be readable before
--   sign-in. todays_birthdays() is for any signed-in staff member or
--   student (not parents, not anon) and returns names only: no dates, no
--   ages.
--
-- 29 February birthdays are celebrated on 28 February in non-leap years.
-- "Today" is the school's (school_today(), Lagos), not the database's UTC.
-- Leavers are left out: students not 'active', staff with a leaving_date
-- that has passed. Only 9 of 62 staff had a date of birth on their HR record
-- when this was written, so staff are missing until HR fills them in on
-- /staff/records.

-- 1. The birthday on a given date ------------------------------------------

create or replace function public.is_birthday_on(p_dob date, p_day date)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select p_dob is not null and (
    to_char(p_dob, 'MMDD') = to_char(p_day, 'MMDD')
    or (
      to_char(p_dob, 'MMDD') = '0229'
      and to_char(p_day, 'MMDD') = '0228'
      and to_char(p_day + 1, 'MMDD') = '0301'  -- not a leap year
    )
  );
$$;

-- 2. Everyone with a birthday in the next p_days days ------------------------

create or replace function public.upcoming_birthdays(p_days integer default 7)
returns table (
  person_type text,          -- 'student' | 'staff'
  person_id integer,
  first_name text,
  last_name text,
  year_group integer,        -- students only
  form_class text,           -- students only
  staff_code text,           -- staff only
  birthday date,             -- the day it falls on, this time round
  days_until integer,        -- 0 = today
  turning_age integer        -- students only; never given for staff
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with days as (
    select d::date as day, (d::date - school_today()) as days_until
    from generate_series(
      school_today(),
      school_today() + greatest(least(coalesce(p_days, 7), 31), 1) - 1,
      interval '1 day'
    ) d
  )
  select 'student', s.student_id, s.first_name, s.last_name, s.year_group,
         s.form_class, null::text, d.day, d.days_until,
         (extract(year from d.day) - extract(year from s.dob))::integer
  from students s
  join days d on is_birthday_on(s.dob, d.day)
  where s.status = 'active'
    and not s.is_demo
    and has_resource_access('/pastoral/birthdays')
  union all
  select 'staff', st.staff_id, st.first_name, st.last_name, null, null,
         st.staff_code, d.day, d.days_until, null
  from staff st
  join staff_hr_profiles h on h.staff_id = st.staff_id
  join days d on is_birthday_on(h.date_of_birth, d.day)
  where not st.is_demo
    and (h.leaving_date is null or h.leaving_date >= school_today())
    and has_resource_access('/pastoral/birthdays')
  order by 9, 1, 4, 3;
$$;

comment on function public.upcoming_birthdays(integer) is
  'Staff and students with a birthday from today through the next p_days days (default 7, max 31). '
  'Students get the age they turn; staff get day/month only. For /pastoral/birthdays.';

-- 3. Today's birthdays, for the splash after sign-in ------------------------

create or replace function public.todays_birthdays()
returns table (
  person_type text,          -- 'student' | 'staff'
  first_name text,
  last_name text,
  form_class text            -- students only
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select 'student', s.first_name, s.last_name, s.form_class
  from students s
  where is_birthday_on(s.dob, school_today())
    and s.status = 'active'
    and not s.is_demo
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'student'))
  union all
  select 'staff', st.first_name, st.last_name, null
  from staff st
  join staff_hr_profiles h on h.staff_id = st.staff_id
  where is_birthday_on(h.date_of_birth, school_today())
    and not st.is_demo
    and (h.leaving_date is null or h.leaving_date >= school_today())
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'staff', 'student'))
  order by 1 desc, 3, 2;
$$;

comment on function public.todays_birthdays() is
  'Names of staff and students whose birthday is today (school time). Signed-in staff and students only; '
  'no dates or ages. Shown on the splash after sign-in.';

revoke all on function public.upcoming_birthdays(integer) from public, anon;
revoke all on function public.todays_birthdays() from public, anon;
grant execute on function public.upcoming_birthdays(integer) to authenticated;
grant execute on function public.todays_birthdays() to authenticated;

-- 4. The Pastoral page --------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/birthdays', 'Birthdays', 'Pastoral', 21)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/pastoral/birthdays'
from unnest(array['admin', 'smt', 'pastoral', 'houseparent', 'school_office']) as r
on conflict do nothing;
