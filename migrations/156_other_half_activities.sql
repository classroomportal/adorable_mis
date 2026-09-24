-- Migration 156: The Other Half — an activity programme students choose
-- from, run in Formwork instead of Nova-T.
--
-- Why: The Other Half (periods.short_label 'OH', period_number 8) has come
-- in from Nova-T as one class per year group (7a/Oh1 .. 11w/Oh1) with every
-- student in the year on it, no teacher and no room. That says nothing about
-- where a child actually is at 15:30: each day the school runs a set of
-- activities, each with its own room and staff, each open to some year
-- groups, and students pick one. Nova-T can't express that, and the school
-- will stop exporting OH groups from it.
--
-- So OH lives in its own tables, not in classes/timetable_slots. That is what
-- keeps a Nova-T import from overwriting it: the importer only ever writes
-- classes, student_class and timetable_slots, and it now skips any group whose
-- subject code is Oh as well (app/admin/import-classes), so leftover OH rows
-- in an export can't recreate the old whole-year classes either.
--
-- The model:
--   other_half_terms          per term: are student choices open, and until when
--   other_half_activities     one activity on one weekday in one term — name,
--                             room, which year groups may take it, capacity
--   other_half_activity_staff who runs it (can be more than one)
--   other_half_choices        a student's activity for one weekday of one term
--
-- An activity repeats every week of its term on its weekday, the same way a
-- timetabled lesson does, and a student makes one choice per weekday.
--
-- Attendance goes into the existing attendance table at the OH period, the
-- same row an ordinary register would write. That keeps OH inside every
-- attendance summary, the "today so far" badges and the parent view with no
-- extra plumbing. attendance.other_half_activity_id records which activity a
-- mark was taken in, so a student who changes activity mid-term doesn't
-- rewrite where they were on earlier dates.
--
-- Who can do what:
--   - A new `other_half` role (the coordinator) and SMT build the programme,
--     open and close choices, and move students between activities.
--   - Students choose through choose_other_half_activity() / drop_…(): they
--     can only read their own choices, and every rule — choices open, their
--     year group, the activity not full — is checked in the database, so a
--     crafted request can't get round it.
--   - Any staff member can take an OH register (attendance RLS already allows
--     that), and parents can see their children's choices.

-- 1. Role and helpers ----------------------------------------------------

insert into roles (role_name, description) values
  ('other_half', 'Other Half coordinator — runs the activity programme and student choices')
on conflict (role_name) do nothing;

-- user_has_staff_role() already lets profiles.role = 'admin' through.
create or replace function can_manage_other_half()
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select user_has_staff_role(array['smt', 'other_half']);
$$;

grant execute on function can_manage_other_half() to authenticated;

-- The OH period is found by its short label, never by number: period_number
-- is offset from the lesson number (see periods in CURRENT_SCHEMA.md).
create or replace function other_half_period()
returns integer
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select period_number from periods where short_label = 'OH' order by period_number limit 1;
$$;

grant execute on function other_half_period() to authenticated;

-- The term the timetable shows OH for: the one running today, or between
-- terms, the next one.
create or replace function current_other_half_term()
returns integer
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select term_id from terms where end_date >= school_today() order by start_date limit 1;
$$;

grant execute on function current_other_half_term() to authenticated;

-- 2. Choice windows ------------------------------------------------------

create table if not exists other_half_terms (
  term_id integer primary key references terms (term_id) on delete cascade,
  choices_open boolean not null default false,
  -- Optional hard close, so choices can be left "open" and still shut on time.
  choices_close_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table other_half_terms enable row level security;
grant select, insert, update, delete on other_half_terms to authenticated;

create policy read_other_half_terms on other_half_terms
  for select using (auth.role() = 'authenticated');
create policy manage_other_half_terms on other_half_terms
  for all using (can_manage_other_half()) with check (can_manage_other_half());

create trigger trg_other_half_terms_updated_at
  before update on other_half_terms
  for each row execute function set_updated_at();

-- 3. Activities ----------------------------------------------------------

create table if not exists other_half_activities (
  activity_id bigserial primary key,
  term_id integer not null references terms (term_id) on delete cascade,
  day_of_week text not null check (day_of_week in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri')),
  activity_name text not null check (btrim(activity_name) <> ''),
  description text,
  room text,
  year_groups integer[] not null check (cardinality(year_groups) > 0),
  -- NULL = no limit.
  capacity integer check (capacity is null or capacity > 0),
  -- An activity with choices or registers against it is retired, not deleted
  -- (other_half_choices restricts the delete), so its history stays readable.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references profiles (id) on delete set null
);

create index if not exists idx_other_half_activities_term_day
  on other_half_activities (term_id, day_of_week);

alter table other_half_activities enable row level security;
grant select, insert, update, delete on other_half_activities to authenticated;
grant usage on sequence other_half_activities_activity_id_seq to authenticated;

-- Students and parents read the programme too — it's what they choose from.
create policy read_other_half_activities on other_half_activities
  for select using (auth.role() = 'authenticated');
create policy manage_other_half_activities on other_half_activities
  for all using (can_manage_other_half()) with check (can_manage_other_half());

create table if not exists other_half_activity_staff (
  activity_id bigint not null references other_half_activities (activity_id) on delete cascade,
  staff_id integer not null references staff (staff_id) on delete cascade,
  primary key (activity_id, staff_id)
);

create index if not exists idx_other_half_activity_staff_staff
  on other_half_activity_staff (staff_id);

alter table other_half_activity_staff enable row level security;
grant select, insert, update, delete on other_half_activity_staff to authenticated;

create policy read_other_half_activity_staff on other_half_activity_staff
  for select using (auth.role() = 'authenticated');
create policy manage_other_half_activity_staff on other_half_activity_staff
  for all using (can_manage_other_half()) with check (can_manage_other_half());

-- 4. Choices -------------------------------------------------------------

create table if not exists other_half_choices (
  choice_id bigserial primary key,
  student_id integer not null references students (student_id) on delete cascade,
  activity_id bigint not null references other_half_activities (activity_id) on delete restrict,
  -- Copied from the activity by the trigger below; they exist so the unique
  -- constraint can say "one activity per student per weekday per term".
  term_id integer not null,
  day_of_week text not null,
  chosen_at timestamptz not null default now(),
  chosen_by uuid default auth.uid() references profiles (id) on delete set null,
  unique (student_id, term_id, day_of_week)
);

create index if not exists idx_other_half_choices_activity
  on other_half_choices (activity_id);

create or replace function other_half_choice_from_activity()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  select a.term_id, a.day_of_week into new.term_id, new.day_of_week
    from other_half_activities a
   where a.activity_id = new.activity_id;
  return new;
end;
$$;

create trigger trg_other_half_choice_from_activity
  before insert or update of activity_id on other_half_choices
  for each row execute function other_half_choice_from_activity();

alter table other_half_choices enable row level security;
-- Students write through the functions below, not the table.
grant select, insert, update, delete on other_half_choices to authenticated;
grant usage on sequence other_half_choices_choice_id_seq to authenticated;

create policy staff_read_other_half_choices on other_half_choices
  for select using (is_staff_or_admin());
create policy student_read_own_other_half_choices on other_half_choices
  for select using (exists (
    select 1 from profiles p
     where p.id = auth.uid() and p.student_id = other_half_choices.student_id));
create policy parent_read_own_other_half_choices on other_half_choices
  for select using (exists (
    select 1 from profiles p
      join student_parent sp on sp.parent_id = p.parent_id
     where p.id = auth.uid() and sp.student_id = other_half_choices.student_id));
create policy manage_other_half_choices on other_half_choices
  for all using (can_manage_other_half()) with check (can_manage_other_half());

-- 5. Student choosing ----------------------------------------------------

create or replace function other_half_choices_open(p_term_id integer)
returns boolean
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((
    select w.choices_open and (w.choices_close_at is null or now() < w.choices_close_at)
      from other_half_terms w where w.term_id = p_term_id), false);
$$;

grant execute on function other_half_choices_open(integer) to authenticated;

create or replace function choose_other_half_activity(p_activity_id bigint)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer;
  v_year integer;
  a other_half_activities%rowtype;
  n integer;
begin
  select student_id into v_student
    from profiles where id = auth.uid() and role = 'student';
  if v_student is null then
    raise exception 'Only a student account can choose an Other Half activity';
  end if;

  -- Locking the activity row serialises everyone choosing it at once, so
  -- the capacity count below can't be raced past.
  select * into a from other_half_activities where activity_id = p_activity_id for update;
  if not found or not a.is_active then
    raise exception 'That activity is not available';
  end if;
  if not other_half_choices_open(a.term_id) then
    raise exception 'Other Half choices are closed';
  end if;

  select year_group into v_year from students where student_id = v_student and status = 'active';
  if v_year is null or not (v_year = any (a.year_groups)) then
    raise exception 'That activity is not open to your year group';
  end if;

  if a.capacity is not null then
    select count(*) into n from other_half_choices
     where activity_id = a.activity_id and student_id <> v_student;
    if n >= a.capacity then
      raise exception 'Sorry, % is full', a.activity_name;
    end if;
  end if;

  insert into other_half_choices (student_id, activity_id, chosen_by)
  values (v_student, a.activity_id, auth.uid())
  on conflict (student_id, term_id, day_of_week)
  do update set activity_id = excluded.activity_id,
                chosen_at = now(),
                chosen_by = excluded.chosen_by;
end;
$$;

grant execute on function choose_other_half_activity(bigint) to authenticated;

create or replace function drop_other_half_choice(p_term_id integer, p_day_of_week text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student integer;
begin
  select student_id into v_student
    from profiles where id = auth.uid() and role = 'student';
  if v_student is null then
    raise exception 'Only a student account can change its own Other Half choice';
  end if;
  if not other_half_choices_open(p_term_id) then
    raise exception 'Other Half choices are closed';
  end if;
  delete from other_half_choices
   where student_id = v_student and term_id = p_term_id and day_of_week = p_day_of_week;
end;
$$;

grant execute on function drop_other_half_choice(integer, text) to authenticated;

-- Places taken per activity. Students can only read their own choices, so
-- they can't count anyone else's; this gives the numbers without the names.
create or replace function other_half_places_taken(p_term_id integer)
returns table (activity_id bigint, taken integer)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.activity_id, count(*)::integer
    from other_half_choices c
   where c.term_id = p_term_id
   group by c.activity_id;
$$;

grant execute on function other_half_places_taken(integer) to authenticated;

-- 6. Attendance ----------------------------------------------------------

alter table attendance
  add column if not exists other_half_activity_id bigint
    references other_half_activities (activity_id) on delete set null;

comment on column attendance.other_half_activity_id is
  'For an Other Half register: the activity the mark was taken in. NULL for every other register.';

-- 7. Timetable -----------------------------------------------------------

-- Each student's chosen activities for the current (or next) term, placed in
-- the OH slot with that day's bell times. security_invoker, so it reads
-- through the caller's RLS on the choices: a student sees theirs, a parent
-- their children's, staff everyone's.
create or replace view other_half_timetable
with (security_invoker = true) as
select c.student_id,
       a.activity_id,
       a.term_id,
       a.day_of_week,
       sd.period_number,
       a.activity_name,
       a.room,
       sd.start_time,
       sd.end_time,
       (select string_agg(s.first_name || ' ' || s.last_name, ', ' order by s.last_name)
          from other_half_activity_staff x
          join staff s on s.staff_id = x.staff_id
         where x.activity_id = a.activity_id) as staff_names
  from other_half_choices c
  join other_half_activities a on a.activity_id = c.activity_id
  left join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
 where a.term_id = current_other_half_term();

grant select on other_half_timetable to authenticated;

-- 8. Pages ---------------------------------------------------------------

-- The Other Half tile on the staff dashboard is built from these (app/page.js
-- filters every tile's items through hasAccess()). Students get their own
-- tile in code; they don't go through role_permissions.
insert into resources (resource_key, label, section, sort_order) values
  ('/other-half',            'My Other Half & Registers', 'Other Half', 60),
  ('/other-half/activities', 'Activity Programme',        'Other Half', 61),
  ('/other-half/choices',    'Student Choices',           'Other Half', 62)
on conflict (resource_key) do nothing;

-- Anyone who might be down to run an activity sees their own OH and its
-- registers; building the programme and moving students is SMT and the
-- coordinator. Admins get everything through has_resource_access().
insert into role_permissions (role_name, resource_key) values
  ('teacher',            '/other-half'),
  ('mentor',             '/other-half'),
  ('houseparent',        '/other-half'),
  ('pastoral',           '/other-half'),
  ('head_of_department', '/other-half'),
  ('school_office',      '/other-half'),
  ('smt',                '/other-half'),
  ('other_half',         '/other-half'),
  ('smt',                '/other-half/activities'),
  ('other_half',         '/other-half/activities'),
  ('smt',                '/other-half/choices'),
  ('other_half',         '/other-half/choices')
on conflict do nothing;
