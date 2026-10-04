-- Migration 353: homework for every year, and days without homework.
--
-- Why: the principal, 4 Oct 2026.
--
-- 1. "Make active for all years." Homework was switched on only for Year 10
--    and 11 teaching groups (migrations 295-296). Now every teaching class in
--    Years 7-12 is switched on, the same way: not Mentor or Prep groups, and
--    not Year 12's Personal Study (private study, not a taught subject).
--    The trigger that switches on new classes now covers every year too.
--    It still only switches on, so an admin's switch-off survives re-imports.
--
-- 2. "Block this week Thursday and Friday for Year 12 as they will be doing
--    mocks." A new list of blocked days, prep_blocks (year group, date,
--    reason), kept on Prep Times (/pastoral/prep). On a blocked day for a
--    year:
--      * no homework for that year can be due (the deadline is refused);
--      * its evening has no homework time, so no homework is put on it:
--        prep_evening_for() skips it and prep_minutes_for() gives 0.
--    Homework already set isn't moved. Seeded with Year 12 on Thursday
--    8 and Friday 9 October 2026, "Mock exams". Blocks can be added and
--    removed by the people who have Prep Times; changes are logged in
--    change_history under 'prep'.

set local formwork.change_note = 'Principal (direct)';

-- ---- 1. Homework for every year -------------------------------------------

create or replace function public.homework_is_teaching_subject(p_subject_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from subjects s
    where s.subject_id = p_subject_id
      and s.subject_name not in ('Mentor', 'Prep', 'Personal Study')
      and coalesce(s.subject_code, '') not in ('Me', 'Pr', 'Ps'));
$$;

revoke execute on function public.homework_is_teaching_subject(integer) from public, anon, authenticated;

insert into public.homework_classes (class_id)
select c.class_id
from public.classes c
where c.year_group between 7 and 12
  and public.homework_is_teaching_subject(c.subject_id)
on conflict (class_id) do nothing;

create or replace function public.homework_switch_on_new_class()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- On an update, only when the year or subject really changed, so a
  -- re-import that rewrites the same values doesn't undo an admin's switch-off.
  if tg_op = 'UPDATE' and new.year_group is not distinct from old.year_group
     and new.subject_id is not distinct from old.subject_id then
    return new;
  end if;
  if new.year_group between 7 and 13 and homework_is_teaching_subject(new.subject_id) then
    insert into homework_classes (class_id) values (new.class_id)
    on conflict (class_id) do nothing;
  end if;
  return new;
end;
$$;

-- ---- 2. Blocked days ------------------------------------------------------

create table public.prep_blocks (
  id bigint generated always as identity primary key,
  year_group integer not null check (year_group between 7 and 13),
  block_on date not null,
  reason text not null check (btrim(reason) <> ''),
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index prep_blocks_one_each on public.prep_blocks (year_group, block_on);

comment on table public.prep_blocks is
  'Days with no homework for a year group (migration 353), e.g. mock exams: nothing can be due that day and its '
  'evening has no homework time. Kept on /pastoral/prep.';

alter table public.prep_blocks enable row level security;
grant select, insert, delete on public.prep_blocks to authenticated;

create policy prep_blocks_read on public.prep_blocks
  for select to authenticated using ((select is_staff_or_admin()));
create policy prep_blocks_add on public.prep_blocks
  for insert to authenticated with check (has_resource_access('/pastoral/prep'));
create policy prep_blocks_delete on public.prep_blocks
  for delete to authenticated using (has_resource_access('/pastoral/prep'));

create trigger trg_stamp_created_by before insert on public.prep_blocks
  for each row execute function public.stamp_actor('created_by');
create trigger trg_log_change after insert or update or delete on public.prep_blocks
  for each row execute function public.log_change('prep', 'id');

insert into public.prep_blocks (year_group, block_on, reason) values
  (12, '2026-10-08', 'Mock exams'),
  (12, '2026-10-09', 'Mock exams');

create or replace function public.prep_blocked(p_year_group integer, p_day date)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select b.reason from prep_blocks b where b.year_group = p_year_group and b.block_on = p_day;
$$;

revoke execute on function public.prep_blocked(integer, date) from public, anon, authenticated;

-- Homework time on a day: none on a blocked day for the student's year.
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
    when exists (select 1 from students s join prep_blocks b on b.year_group = s.year_group
                 where s.student_id = p_student_id and b.block_on = p_day) then 0
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

-- The prep evening before a deadline skips the year's blocked days.
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
    and not exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = d::date)
    and not exists (select 1 from prep_blocks b where b.year_group = p_year_group and b.block_on = d::date);
$$;

-- Same as migration 352, plus: no deadline on a blocked day.
create or replace function public.homework_prep_time_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_short integer;
  v_names text;
  v_block text;
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
  v_block := prep_blocked(new.year_group, new.due_on);
  if v_block is not null then
    raise exception 'Year % has no homework on % (%). Choose another deadline.',
      new.year_group, to_char(new.due_on, 'Dy FMDD Mon'), v_block;
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
