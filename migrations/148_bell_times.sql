-- Migration 148: one editable bell-time per day and period, and the rest of
-- the Mon–Thu day moved onto the school's real times.
--
-- Lesson times only existed as a start/end on every individual
-- timetable_slots row, with no way to change them from the app. When the
-- bell times changed, about 80 Mon–Thu slots kept the old ones (08:20,
-- 10:20, 11:10, 13:00, 13:50 starts), and Registers Not Done flagged their
-- registers at the wrong time (migration 147 fixed Lesson 1 only).
--
-- 1. The school confirmed the Mon–Thu times for Lessons 2–6:
--      L2 09:55–10:50   L3 11:15–12:05   L4 12:10–13:00
--      L5 13:35–14:25   L6 14:30–15:25
--    (L1 09:00–09:50 is already set, by 147.) Friday is a different, shorter
--    day and was confirmed correct as is, so it is not touched.
--
-- 2. bell_times holds one start/end per (day_of_week, period_number), seeded
--    from the most common time on each day/period after step 1. It is edited
--    from /admin/bell-times.
--
-- 3. Saving a bell time rewrites every timetable_slots row for that day and
--    period, so an edit reaches every class at once and nothing is left on
--    the old time. A slot inserted later (e.g. a re-import) takes the bell
--    time too, for the same reason.
--
-- Registers are keyed on period_number, not time, so no attendance moves.

-- 1. Mon–Thu lesson times (period_number is lesson number + 1).
update timetable_slots ts
   set start_time = v.start_time, end_time = v.end_time
  from (values
    (3, time '09:55', time '10:50'),
    (4, time '11:15', time '12:05'),
    (5, time '12:10', time '13:00'),
    (6, time '13:35', time '14:25'),
    (7, time '14:30', time '15:25')
  ) as v(period_number, start_time, end_time)
 where ts.period_number = v.period_number
   and ts.day_of_week in ('Mon', 'Tue', 'Wed', 'Thu');

-- 2. The bell_times table.
create table if not exists bell_times (
  day_of_week   text    not null check (day_of_week in ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
  period_number integer not null references periods (period_number),
  start_time    time    not null,
  end_time      time    not null,
  primary key (day_of_week, period_number),
  check (end_time > start_time)
);

alter table bell_times enable row level security;

-- Explicit Data API grant: from 30 Oct 2026 Supabase no longer grants new
-- public tables to the API roles automatically. RLS still decides the rows.
grant select, insert, update, delete on bell_times to authenticated;

create policy read_all_bell_times on bell_times
  for select using (auth.role() = 'authenticated');

create policy admin_write_bell_times on bell_times
  for all using (is_admin()) with check (is_admin());

-- 3. Keep timetable_slots on the bell times.
create or replace function apply_bell_time()
returns trigger
language plpgsql
as $$
begin
  update timetable_slots
     set start_time = new.start_time,
         end_time   = new.end_time
   where day_of_week = new.day_of_week
     and period_number = new.period_number
     and (start_time, end_time) is distinct from (new.start_time, new.end_time);
  return new;
end;
$$;

-- Seeded before the triggers exist, so seeding leaves every slot as it is.
insert into bell_times (day_of_week, period_number, start_time, end_time)
select day_of_week,
       period_number,
       mode() within group (order by start_time),
       mode() within group (order by end_time)
  from timetable_slots
 group by day_of_week, period_number
on conflict do nothing;

create trigger bell_times_apply
  after insert or update on bell_times
  for each row execute function apply_bell_time();

create or replace function timetable_slot_takes_bell_time()
returns trigger
language plpgsql
as $$
declare
  b bell_times%rowtype;
begin
  select * into b from bell_times
   where day_of_week = new.day_of_week and period_number = new.period_number;
  if found then
    new.start_time := b.start_time;
    new.end_time := b.end_time;
  end if;
  return new;
end;
$$;

create trigger timetable_slots_take_bell_time
  before insert on timetable_slots
  for each row execute function timetable_slot_takes_bell_time();

-- The page, under the Timetable tile.
insert into resources (resource_key, label, section, sort_order) values
  ('/admin/bell-times', 'Bell Times', 'Timetable', 52)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('admin', '/admin/bell-times')
on conflict do nothing;
