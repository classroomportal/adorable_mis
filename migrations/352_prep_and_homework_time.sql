-- Migration 352: prep times, and how long homework takes.
--
-- Why: the principal, 4 Oct 2026. Homework is done in evening prep, which
-- starts at 7.00 pm. For KS3 the first hour is a fixed activity, reviewing
-- the day's work (the school has its own routine for it), so it isn't
-- homework time. Prep ends at different times for different years: KS3 at
-- 9.15 pm and KS4 at 9.45 pm at the moment. Year 12 also has private study
-- on the timetable (Nova-T's "Personal Study", subject code Ps). All of this
-- goes into one lookup under Pastoral, and it limits how much homework can
-- be set: each homework now says how long it takes, and the teacher puts it
-- on a prep evening before the deadline that still has room for every
-- student in the class.
--
--   * prep_settings: one row per year group. Prep start and end, the days
--     prep runs (Mon-Fri, as the EP period on the timetable), the fixed
--     activity and its minutes, and whether timetabled private study counts
--     as homework time. Edited at /pastoral/prep; read by every signed-in
--     member of staff. Logged in change_history under the new area 'prep'.
--   * Homework time on a day for a student = (prep end - prep start - fixed
--     minutes), if prep runs that day for their year, plus the length of
--     their private-study lessons that day if their year counts them.
--     Nothing on a day outside term or with a 'holiday' calendar event.
--     prep_minutes_for(student, day) works it out.
--   * homework.minutes (how long it should take) and homework.prep_on (the
--     day it is to be done). Every homework already set is given 30
--     minutes, as asked, and the last prep day before its deadline (not
--     before the day it was set).
--   * trg_homework_z_prep_time (named to run after trg_homework_prepare)
--     checks, on a new homework and whenever its minutes, prep day or
--     deadline change (not on withdrawing or restoring): the prep day is today or later and before the
--     deadline, and every student in the class (who has joined by then) has
--     room for it that day once their other homework for that day is
--     counted. Old homework can still be edited (title, instructions) without
--     being re-checked.
--   * homework_prep_days(class, due_on, minutes, homework_id) lists the
--     days from today to the deadline with the room left, for the form.
--     It returns counts only, never another class's homework. Callable by
--     those who can set homework for the class.
--
-- Prep for KS3 counts 75 minutes (7.00-9.15 less the hour's review), KS4
-- 165 minutes (7.00-9.45). Year 12 is seeded like KS4 plus private study.

set local formwork.change_note = 'Principal (direct)';

-- ---- The lookup ------------------------------------------------------------

create table public.prep_settings (
  year_group integer primary key check (year_group between 7 and 13),
  prep_starts time not null default '19:00',
  prep_ends time not null,
  prep_days text[] not null default array['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
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
  (12, '19:00', '21:45', null, 0, true);

-- The page, for the people who look after boarding and evenings.
insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/prep', 'Prep Times', 'Pastoral', 23)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/pastoral/prep'
from unnest(array['admin', 'smt', 'pastoral', 'head_of_boarding']) as r
on conflict do nothing;

-- ---- Homework: minutes and prep day ---------------------------------------

alter table public.homework add column minutes integer check (minutes between 5 and 240);
alter table public.homework add column prep_on date;

comment on column public.homework.minutes is 'How long the homework should take, in minutes (migration 352). Homework set before then: 30.';
comment on column public.homework.prep_on is 'The prep day the homework is to be done on, before the deadline (migration 352).';

-- Everything already set: 30 minutes, on the last prep day before the
-- deadline that isn't before the day it was set (none if there isn't one).
update public.homework h
set minutes = 30,
    prep_on = (
      select max(d)::date
      from generate_series(h.set_on, h.due_on - 1, interval '1 day') d
      where to_char(d, 'Dy') = any (coalesce((select ps.prep_days from prep_settings ps where ps.year_group = h.year_group),
                                             array['Mon', 'Tue', 'Wed', 'Thu', 'Fri']))
    );

alter table public.homework alter column minutes set default 30;
alter table public.homework alter column minutes set not null;

create index homework_prep_on_idx on public.homework (prep_on) where status = 'set';

-- ---- Homework time on a day ------------------------------------------------

-- Minutes of homework time a student has on a day: prep (less the fixed
-- activity) plus counted private-study lessons. 0 outside term and on
-- holidays. Internal: called by the trigger and homework_prep_days().
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

create or replace function public.homework_prep_time_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_short integer;
  v_names text;
  v_free integer;
begin
  if tg_op = 'UPDATE'
     and new.minutes is not distinct from old.minutes
     and new.prep_on is not distinct from old.prep_on
     and new.due_on is not distinct from old.due_on then
    return new;
  end if;
  if new.status <> 'set' then
    return new;
  end if;

  if new.minutes is null then
    raise exception 'Say how many minutes the homework should take.';
  end if;
  if new.prep_on is null then
    raise exception 'Choose the prep evening the homework is to be done on.';
  end if;
  if new.prep_on >= new.due_on then
    raise exception 'The prep evening must be before the deadline.';
  end if;
  if (tg_op = 'INSERT' or new.prep_on is distinct from old.prep_on) and new.prep_on < school_today() then
    raise exception 'That prep evening has already passed.';
  end if;

  -- Every student in the class who has joined by the deadline needs room.
  with st as (
    select s.student_id, s.first_name, s.last_name,
           prep_minutes_for(s.student_id, new.prep_on)
             - prep_minutes_used(s.student_id, new.prep_on, new.homework_id) as free
    from student_class sc
    join students s on s.student_id = sc.student_id and s.status = 'active'
    where sc.class_id = new.class_id
      and sc.joined_on <= new.due_on
  )
  select count(*) filter (where free < new.minutes),
         array_to_string((array_agg(first_name || ' ' || last_name || ' (' || greatest(free, 0) || ' min left)' order by free, last_name, first_name)
           filter (where free < new.minutes))[1:5], ', '),
         min(free)
  into v_short, v_names, v_free
  from st;

  if v_short > 0 then
    raise exception 'Not enough prep time on % for % minutes: % student% would run out of time (%). Choose another evening or a shorter homework.',
      to_char(new.prep_on, 'Dy FMDD Mon'), new.minutes, v_short, case when v_short = 1 then '' else 's' end,
      v_names || case when v_short > 5 then ' and ' || (v_short - 5) || ' more' else '' end;
  end if;
  return new;
end;
$$;

revoke execute on function public.homework_prep_time_check() from public, anon, authenticated;

create trigger trg_homework_z_prep_time before insert or update on public.homework
  for each row execute function public.homework_prep_time_check();

-- The form's list of evenings: each day from today to the day before the
-- deadline, with how many students there are, the least room any of them
-- has left, and how many couldn't fit p_minutes. Counts only.
create or replace function public.homework_prep_days(
  p_class_id integer,
  p_due_on date,
  p_minutes integer,
  p_homework_id bigint default null
)
returns table (
  prep_on date,
  students integer,
  least_free integer,
  most_time integer,
  students_short integer
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_set_homework(p_class_id) or p_due_on is null or p_due_on - school_today() > 60 then
    return;
  end if;

  return query
  with days as (
    select d::date as day
    from generate_series(school_today(), p_due_on - 1, interval '1 day') d
  ),
  st as (
    select s.student_id
    from student_class sc
    join students s on s.student_id = sc.student_id and s.status = 'active'
    where sc.class_id = p_class_id and sc.joined_on <= p_due_on
  ),
  room as (
    select days.day, st.student_id,
           prep_minutes_for(st.student_id, days.day) as total,
           prep_minutes_for(st.student_id, days.day) - prep_minutes_used(st.student_id, days.day, p_homework_id) as free
    from days cross join st
  )
  select r.day, count(*)::integer, min(r.free)::integer, max(r.total)::integer,
         (count(*) filter (where r.free < coalesce(p_minutes, 0)))::integer
  from room r
  group by r.day
  having max(r.total) > 0
  order by r.day;
end;
$$;

revoke all on function public.homework_prep_days(integer, date, integer, bigint) from public, anon;
grant execute on function public.homework_prep_days(integer, date, integer, bigint) to authenticated;
