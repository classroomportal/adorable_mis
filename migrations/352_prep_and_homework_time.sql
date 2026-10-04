-- Migration 352: prep times, and how long homework takes.
--
-- Why: the principal, 4 Oct 2026. Homework is done in evening prep, which
-- starts at 7.00 pm. For KS3 the first hour is a fixed activity, reviewing
-- the day's work (the school has its own routine for it), so it isn't
-- homework time. Prep ends at different times for different years: KS3 at
-- 9.15 pm and KS4 at 9.45 pm at the moment. Prep runs Sunday to Friday
-- evenings. All of this goes into one lookup under Pastoral, and it limits
-- how much homework can be set: each homework now says how long it takes,
-- and it is done in prep the evening before its deadline.
--
--   * prep_settings: one row per year group. Prep start and end, the days
--     prep runs (Sun-Fri), the fixed activity and its minutes, and whether
--     timetabled private study (Nova-T's Personal Study, code Ps) counts as
--     homework time. That is for a future Year 13, who will have 3 hours of
--     private study on the timetable; no year counts it yet (there is no
--     Year 13 at the moment). Edited at /pastoral/prep; read by every
--     signed-in member of staff. Logged in change_history, new area 'prep'.
--   * Homework time on a day for a student = (prep end - prep start - fixed
--     minutes), if prep runs that day for their year, plus the length of
--     their private-study lessons that day if their year counts them.
--     Nothing on a day outside term or with a 'holiday' calendar event.
--     prep_minutes_for(student, day) works it out.
--   * homework.minutes (how long it should take) and homework.prep_on (the
--     prep evening it is done on). prep_on is never taken from the request:
--     the database sets it to the year's last prep evening before the
--     deadline (prep_evening_for(), normally the day before; Sunday for a
--     Monday deadline), so homework set weeks ahead still lands the evening
--     before it is due. Every homework already set is given 30 minutes, as
--     asked, and its prep evening the same way.
--   * trg_homework_z_prep_time (named to run after trg_homework_prepare,
--     which fills in the year group) sets prep_on and checks, on a new
--     homework and whenever its minutes or deadline change (not on
--     withdrawing, restoring or a title edit): there is a prep evening
--     before the deadline, it hasn't passed, and every student in the class
--     (who has joined by the deadline) has room for it that evening once
--     their other homework for that evening, from any class, is counted.
--   * homework_prep_check(class, due_on, minutes, homework_id) tells the
--     form which evening a deadline puts the homework on and the room left.
--     Counts only, never another class's homework; for those who can set
--     homework for the class.
--
--   * homework_plans: a student can move a homework's card to an earlier
--     day for their own planning (end of this file).
--
-- Prep for KS3 counts 75 minutes (7.00-9.15 less the hour's review); KS4
-- and Year 12 165 minutes (7.00-9.45).

set local formwork.change_note = 'Principal (direct)';

-- ---- The lookup ------------------------------------------------------------

create table public.prep_settings (
  year_group integer primary key check (year_group between 7 and 13),
  prep_starts time not null default '19:00',
  prep_ends time not null,
  prep_days text[] not null default array['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  fixed_activity text,
  fixed_minutes integer not null default 0 check (fixed_minutes >= 0),
  counts_private_study boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (prep_ends > prep_starts),
  check (fixed_minutes * interval '1 minute' <= prep_ends - prep_starts),
  check (prep_days <@ array['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
);

comment on table public.prep_settings is
  'Evening prep per year group (migration 352): times, days, the fixed activity (KS3 review of the day''s work) and '
  'whether timetabled private study counts. Limits how much homework can be set on a day. Edited at /pastoral/prep.';

alter table public.prep_settings enable row level security;
grant select, insert, update, delete on public.prep_settings to authenticated;

create policy prep_settings_read on public.prep_settings
  for select to authenticated using ((select is_staff_or_admin()));
create policy prep_settings_add on public.prep_settings
  for insert to authenticated with check (has_resource_access('/pastoral/prep'));
create policy prep_settings_edit on public.prep_settings
  for update to authenticated using (has_resource_access('/pastoral/prep')) with check (has_resource_access('/pastoral/prep'));
create policy prep_settings_delete on public.prep_settings
  for delete to authenticated using (has_resource_access('/pastoral/prep'));

create or replace function public.prep_settings_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.fixed_activity := nullif(btrim(coalesce(new.fixed_activity, '')), '');
  return new;
end;
$$;

create trigger trg_prep_settings_touch before insert or update on public.prep_settings
  for each row execute function public.prep_settings_touch();
create trigger trg_stamp_updated_by before insert or update on public.prep_settings
  for each row execute function public.stamp_actor('updated_by');

alter table public.change_history drop constraint if exists change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions', 'groups', 'students', 'reading_ages', 'finance', 'prep'));

create trigger trg_log_change after insert or update or delete on public.prep_settings
  for each row execute function public.log_change('prep', 'year_group');

insert into public.prep_settings (year_group, prep_starts, prep_ends, fixed_activity, fixed_minutes, counts_private_study) values
  (7,  '19:00', '21:15', 'Review of the day''s work', 60, false),
  (8,  '19:00', '21:15', 'Review of the day''s work', 60, false),
  (9,  '19:00', '21:15', 'Review of the day''s work', 60, false),
  (10, '19:00', '21:45', null, 0, false),
  (11, '19:00', '21:45', null, 0, false),
  (12, '19:00', '21:45', null, 0, false);

-- The page, for the people who look after boarding and evenings.
insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/prep', 'Prep Times', 'Pastoral', 23)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/pastoral/prep'
from unnest(array['admin', 'smt', 'pastoral', 'head_of_boarding']) as r
on conflict do nothing;

-- ---- Homework: minutes and prep evening ------------------------------------

alter table public.homework add column minutes integer check (minutes between 5 and 240);
alter table public.homework add column prep_on date;

comment on column public.homework.minutes is 'How long the homework should take, in minutes (migration 352). Homework set before then: 30.';
comment on column public.homework.prep_on is 'The prep evening the homework is done on: the year''s last prep evening before the deadline, set by the database (migration 352).';

create index homework_prep_on_idx on public.homework (prep_on) where status = 'set';

-- ---- Homework time on a day ------------------------------------------------

-- Minutes of homework time a student has on a day: prep (less the fixed
-- activity) plus counted private-study lessons. 0 outside term and on
-- holidays. Internal: called by the trigger and homework_prep_check().
create or replace function public.prep_minutes_for(p_student_id integer, p_day date)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when not exists (select 1 from terms t where p_day between t.start_date and t.end_date) then 0
    when exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = p_day) then 0
    else coalesce((
      select case when to_char(p_day, 'Dy') = any (ps.prep_days)
                  then (extract(epoch from ps.prep_ends - ps.prep_starts) / 60)::integer - ps.fixed_minutes
                  else 0 end
           + case when ps.counts_private_study then coalesce((
               select sum(extract(epoch from ts.end_time - ts.start_time) / 60)::integer
               from student_class sc
               join classes c on c.class_id = sc.class_id
               join subjects sub on sub.subject_id = c.subject_id
               join timetable_slots ts on ts.class_id = c.class_id
               where sc.student_id = p_student_id
                 and sub.subject_code = 'Ps'
                 and ts.day_of_week = to_char(p_day, 'Dy')
                 and ts.start_time is not null and ts.end_time > ts.start_time
             ), 0) else 0 end
      from students s
      join prep_settings ps on ps.year_group = s.year_group
      where s.student_id = p_student_id
    ), 0)
  end;
$$;

revoke execute on function public.prep_minutes_for(integer, date) from public, anon, authenticated;

-- Minutes of homework a student already has on a day, leaving one homework
-- out (the one being edited).
create or replace function public.prep_minutes_used(p_student_id integer, p_day date, p_except bigint)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(sum(h.minutes), 0)::integer
  from homework h
  join student_class sc on sc.class_id = h.class_id and sc.student_id = p_student_id
  where h.status = 'set'
    and h.prep_on = p_day
    and h.homework_id is distinct from p_except
    and h.due_on >= sc.joined_on;
$$;

revoke execute on function public.prep_minutes_used(integer, date, bigint) from public, anon, authenticated;

-- The prep evening a homework due on p_due_on is done on, for a year
-- group: the last day in the week before the deadline on which that year
-- has prep, inside a term and not a holiday. Null if there isn't one.
create or replace function public.prep_evening_for(p_year_group integer, p_due_on date)
returns date
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select max(d)::date
  from prep_settings ps,
       generate_series(p_due_on - 7, p_due_on - 1, interval '1 day') d
  where ps.year_group = p_year_group
    and to_char(d, 'Dy') = any (ps.prep_days)
    and exists (select 1 from terms t where d::date between t.start_date and t.end_date)
    and not exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = d::date);
$$;

revoke execute on function public.prep_evening_for(integer, date) from public, anon, authenticated;

-- Everything already set: 30 minutes, on the prep evening before its deadline.
update public.homework h
set minutes = 30,
    prep_on = prep_evening_for(h.year_group, h.due_on);

alter table public.homework alter column minutes set default 30;
alter table public.homework alter column minutes set not null;

create or replace function public.homework_prep_time_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_short integer;
  v_names text;
begin
  if tg_op = 'UPDATE'
     and new.minutes is not distinct from old.minutes
     and new.due_on is not distinct from old.due_on then
    new.prep_on := old.prep_on;
    return new;
  end if;

  new.prep_on := prep_evening_for(new.year_group, new.due_on);
  if new.status <> 'set' then
    return new;
  end if;
  if new.minutes is null then
    raise exception 'Say how many minutes the homework should take.';
  end if;
  if new.prep_on is null then
    raise exception 'There is no prep evening for Year % in the week before that deadline. Choose another deadline.', new.year_group;
  end if;
  if new.prep_on < school_today() then
    raise exception 'That deadline''s prep evening (%) has already passed. Choose a later deadline.', to_char(new.prep_on, 'Dy FMDD Mon');
  end if;

  -- Every student in the class who has joined by the deadline needs room.
  with st as (
    select s.first_name, s.last_name,
           prep_minutes_for(s.student_id, new.prep_on)
             - prep_minutes_used(s.student_id, new.prep_on, new.homework_id) as free
    from student_class sc
    join students s on s.student_id = sc.student_id and s.status = 'active'
    where sc.class_id = new.class_id
      and sc.joined_on <= new.due_on
  )
  select count(*) filter (where free < new.minutes),
         array_to_string((array_agg(first_name || ' ' || last_name || ' (' || greatest(free, 0) || ' min left)' order by free, last_name, first_name)
           filter (where free < new.minutes))[1:5], ', ')
  into v_short, v_names
  from st;

  if v_short > 0 then
    raise exception 'Not enough prep time on % for % minutes: % student% would run out of time (%). Choose a shorter homework or another deadline.',
      to_char(new.prep_on, 'Dy FMDD Mon'), new.minutes, v_short, case when v_short = 1 then '' else 's' end,
      v_names || case when v_short > 5 then ' and ' || (v_short - 5) || ' more' else '' end;
  end if;
  return new;
end;
$$;

revoke execute on function public.homework_prep_time_check() from public, anon, authenticated;

create trigger trg_homework_z_prep_time before insert or update on public.homework
  for each row execute function public.homework_prep_time_check();

-- For the form: the evening a deadline puts the homework on, how many
-- students there are, the least room any of them has left, and how many
-- couldn't fit p_minutes. Counts only.
create or replace function public.homework_prep_check(
  p_class_id integer,
  p_due_on date,
  p_minutes integer,
  p_homework_id bigint default null
)
returns table (
  prep_on date,
  students integer,
  least_free integer,
  students_short integer
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_day date;
begin
  if not can_set_homework(p_class_id) or p_due_on is null then
    return;
  end if;
  v_day := prep_evening_for((select c.year_group from classes c where c.class_id = p_class_id), p_due_on);
  if v_day is null then
    return query select null::date, 0, 0, 0;
    return;
  end if;

  return query
  with st as (
    select prep_minutes_for(s.student_id, v_day) - prep_minutes_used(s.student_id, v_day, p_homework_id) as free
    from student_class sc
    join students s on s.student_id = sc.student_id and s.status = 'active'
    where sc.class_id = p_class_id and sc.joined_on <= p_due_on
  )
  select v_day, count(*)::integer, coalesce(min(st.free), 0)::integer,
         (count(*) filter (where st.free < coalesce(p_minutes, 0)))::integer
  from st;
end;
$$;

revoke all on function public.homework_prep_check(integer, date, integer, bigint) from public, anon;
grant execute on function public.homework_prep_check(integer, date, integer, bigint) to authenticated;

-- ---- A student's own plan --------------------------------------------------
--
-- The principal, 4 Oct 2026: a student can move a homework's card to an
-- earlier day for their own planning. homework_plans holds that day, one row
-- per student per homework, written only by the student for themself. It
-- changes nothing else: the homework stays on its prep evening for the
-- teacher and for the time check, and staff don't see the plans. The day
-- must be today or later and before the homework's prep evening; moving it
-- back to the prep evening deletes the row. Its key is its own id, with
-- (homework_id, student_id) unique by index only, so PostgREST doesn't take
-- it for a junction table (migration 306).

create table public.homework_plans (
  id bigint generated always as identity primary key,
  homework_id bigint not null references public.homework (homework_id) on delete cascade,
  student_id integer not null references public.students (student_id) on delete cascade,
  plan_on date not null,
  updated_at timestamptz not null default now()
);

create unique index homework_plans_one_each on public.homework_plans (homework_id, student_id);
create index homework_plans_student_day on public.homework_plans (student_id, plan_on);

comment on table public.homework_plans is
  'A student''s own earlier day for a homework (migration 352), for their planning only. Written and read only by the student.';

alter table public.homework_plans enable row level security;
grant select, insert, update, delete on public.homework_plans to authenticated;

create policy "Students read their own homework plans"
  on public.homework_plans for select to authenticated
  using (student_id = my_student_id());
create policy "Students plan their own homework"
  on public.homework_plans for insert to authenticated
  with check (
    student_id = my_student_id()
    and exists (select 1 from homework h where h.homework_id = homework_plans.homework_id and h.status = 'set'));
create policy "Students change their own homework plans"
  on public.homework_plans for update to authenticated
  using (student_id = my_student_id())
  with check (student_id = my_student_id());
create policy "Students remove their own homework plans"
  on public.homework_plans for delete to authenticated
  using (student_id = my_student_id());

create or replace function public.homework_plans_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prep date;
begin
  if tg_op = 'UPDATE' and (new.homework_id <> old.homework_id or new.student_id <> old.student_id) then
    raise exception 'A plan can only be moved to another day.';
  end if;
  select coalesce(h.prep_on, h.due_on - 1) into v_prep from homework h where h.homework_id = new.homework_id;
  if new.plan_on < school_today() then
    raise exception 'Choose today or a later day.';
  end if;
  if new.plan_on >= v_prep then
    raise exception 'A homework can only be moved to a day before its prep evening (%).', to_char(v_prep, 'Dy FMDD Mon');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.homework_plans_check() from public, anon, authenticated;

create trigger trg_homework_plans_check before insert or update on public.homework_plans
  for each row execute function public.homework_plans_check();
