-- Migration 182: a lesson can have its own teacher and room, and the
-- current timetable is corrected to match Nova-T lesson for lesson.
--
-- Why: Nova-T gives every lesson its own teacher and room, but a Formwork
-- class held one of each, so the class importer kept whichever appeared
-- most often and applied it to every lesson. 8A1/Hu is LEE one lesson and
-- VAE the other, so Formwork had LEE teaching VAE's Tuesday lesson — at the
-- same time as LEE's own 9C1/Hi. That produced 7 teacher and 14 room
-- "clashes" that aren't in Nova-T (checked against TBTRA-F.DAT on
-- 26 Sep 2026: Nova-T has none), and put the wrong teacher on registers,
-- registers_not_done and staff timetables for those lessons.
--
-- 1. timetable_slots.staff_id / room: the lesson's own teacher and room,
--    set only where they differ from the class's. NULL means "the
--    class's", so changing a class's teacher still moves every lesson
--    without one of its own. room = '' means the lesson has no room
--    (Nova-T leaves it blank), e.g. 11E's Tue/Thu registration with HCC,
--    which would otherwise sit in the class's CHEM while FIO teaches 12a
--    there. The importer (app/admin/import-classes) now writes these, and
--    lib/lessons.js is how pages read them.
--
-- 2. registers_not_done lists a lesson against its own teacher, so VAE —
--    not LEE — is chased for VAE's 8A1/Hu register. capture_register_alerts
--    reads staff_id from the view, so alerts follow without a change.
--
-- 3. The 36 lessons whose teacher or room differs from their class's in
--    Nova-T (20 real differences, 16 lessons Nova-T gives no room). After
--    this every lesson's teacher and room matches the Nova-T files, and no
--    teacher or room is in two places at once.
--
-- 4. The 12 pupils moved into the new 7L form still had their old form's
--    PE group (7A1/Pe, 7C1/Pe or 7G1/Pe) alongside 7L1/Pe, which put them
--    in two lessons at once three times a week. The UPN/Class import only
--    ever added enrolments (it now also removes ones the export no longer
--    lists). Only pupils already in 7L1/Pe are touched; their attendance
--    history is kept.
--
-- The table already has its grants; the new columns inherit them.

-- 1.
alter table timetable_slots
  add column if not exists staff_id integer references staff (staff_id) on delete set null,
  add column if not exists room text;

comment on column timetable_slots.staff_id is
  'This lesson''s own teacher, where it differs from the class''s (classes.staff_id). NULL = the class''s teacher.';
comment on column timetable_slots.room is
  'This lesson''s own room, where it differs from the class''s (classes.room). NULL = the class''s room; '''' = no room.';

create index if not exists timetable_slots_staff_id_idx on timetable_slots (staff_id) where staff_id is not null;

-- 2. Same as migration 157 except the teacher: coalesce(ts.staff_id, c.staff_id).
create or replace view registers_not_done
with (security_invoker = true) as
select ts.slot_id,
       coalesce(ts.staff_id, c.staff_id) as staff_id,
       (s.first_name || ' ') || s.last_name as teacher_name,
       c.class_code,
       ts.period_number,
       p.period_name,
       p.short_label,
       ts.start_time,
       extract(epoch from school_now() - (school_today() + ts.start_time)) / 60::numeric as minutes_since_start,
       null::bigint as other_half_activity_id,
       array[coalesce(ts.staff_id, c.staff_id)] as staff_ids
  from timetable_slots ts
  join classes c on c.class_id = ts.class_id
  join staff s on s.staff_id = coalesce(ts.staff_id, c.staff_id)
  left join periods p on p.period_number = ts.period_number
 where ts.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy')
   and school_now() > (school_today() + ts.start_time + interval '15 minutes')
   and exists (select 1 from terms t
                where school_today() >= t.start_date and school_today() <= t.end_date)
   and exists (select 1 from student_class sc where sc.class_id = ts.class_id)
   and not exists (select 1 from attendance a
                     join student_class sc on sc.student_id = a.student_id
                    where sc.class_id = ts.class_id
                      and a.period_number = ts.period_number
                      and a.attend_date = school_today())
union all
select null::integer as slot_id,
       null::integer as staff_id,
       coalesce(st.names, 'No staff assigned') as teacher_name,
       'Other Half: ' || a.activity_name as class_code,
       sd.period_number,
       sd.period_name,
       sd.short_label,
       sd.start_time,
       extract(epoch from school_now() - (school_today() + sd.start_time)) / 60::numeric as minutes_since_start,
       a.activity_id as other_half_activity_id,
       coalesce(st.ids, '{}'::integer[]) as staff_ids
  from other_half_activities a
  join terms t on t.term_id = a.term_id
  join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
  left join lateral (
    select array_agg(s.staff_id order by s.last_name) as ids,
           string_agg(s.first_name || ' ' || s.last_name, ', ' order by s.last_name) as names
      from other_half_activity_staff x
      join staff s on s.staff_id = x.staff_id
     where x.activity_id = a.activity_id
  ) st on true
 where a.is_active
   and a.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy')
   and school_today() between t.start_date and t.end_date
   and school_now() > (school_today() + sd.start_time + interval '15 minutes')
   and exists (select 1 from other_half_choices c
                 join students stu on stu.student_id = c.student_id
                where c.activity_id = a.activity_id and stu.status = 'active')
   and not exists (select 1 from attendance m
                    where m.other_half_activity_id = a.activity_id
                      and m.attend_date = school_today());

-- 3. (class code, day, period, Nova-T teacher code if not the class's,
--    Nova-T room if not the class's — '' where Nova-T has none)
do $$
declare
  n integer;
begin
  with fix (class_code, day_of_week, period_number, staff_code, room) as (
    values
    ('10HB/Hb', 'Wed', 3, null, 'CG3'),
    ('11E/Me', 'Thu', 1, 'HCC', ''),
    ('11E/Me', 'Tue', 1, 'HCC', ''),
    ('11EC/Ec', 'Wed', 5, null, 'CT4'),
    ('11X/Ex', 'Wed', 5, null, 'DG1'),
    ('11X/Ex', 'Tue', 3, 'UIS', 'AT4'),
    ('12B/Ps', 'Wed', 2, null, ''),
    ('12B/Ps', 'Tue', 6, null, ''),
    ('12B/Ps', 'Thu', 6, null, ''),
    ('12B/Ps', 'Fri', 2, null, ''),
    ('12B/Ps', 'Mon', 6, null, ''),
    ('12G/Ps', 'Wed', 2, null, ''),
    ('12G/Ps', 'Tue', 6, null, ''),
    ('12G/Ps', 'Thu', 6, null, ''),
    ('12G/Ps', 'Fri', 2, null, ''),
    ('12G/Ps', 'Mon', 6, null, ''),
    ('12M/Me', 'Fri', 1, null, ''),
    ('12M/Me', 'Mon', 1, null, ''),
    ('12T/Me', 'Fri', 1, null, ''),
    ('12T/Me', 'Mon', 1, null, ''),
    ('12U/Me', 'Fri', 1, null, ''),
    ('12U/Me', 'Mon', 1, null, ''),
    ('7A1/En', 'Wed', 7, null, 'AG4'),
    ('7A1/En', 'Tue', 7, null, 'AG4'),
    ('7A1/Sc', 'Tue', 3, null, 'CHEM'),
    ('7C/Me', 'Thu', 1, 'MOB', null),
    ('7C/Me', 'Tue', 1, 'MOB', null),
    ('7L1/En', 'Tue', 5, null, 'AT3'),
    ('7L1/Me', 'Wed', 4, null, 'AG2'),
    ('7L1/Sc', 'Mon', 5, null, 'AT1'),
    ('7L1/Sc', 'Tue', 4, null, 'SCI'),
    ('8A1/Hu', 'Tue', 4, 'VAE', null),
    ('8C1/Hu', 'Thu', 3, 'VAE', null),
    ('8C1/Sc', 'Mon', 7, null, 'BIOL'),
    ('8C1/Sc', 'Wed', 7, null, 'AT4'),
    ('8G1/Hu', 'Wed', 4, 'VAE', null)
  )
  update timetable_slots ts
     set staff_id = st.staff_id,
         room = fix.room
    from fix
    join classes c on c.class_code = fix.class_code
    left join staff st on st.staff_code = fix.staff_code
   where ts.class_id = c.class_id
     and ts.day_of_week = fix.day_of_week
     and ts.period_number = fix.period_number
     and (fix.staff_code is null or st.staff_id is not null);
  get diagnostics n = row_count;
  if n <> 36 then
    raise exception 'expected to set 36 lessons, matched %', n;
  end if;
end $$;

-- 4.
do $$
declare
  n integer;
begin
  delete from student_class x
   using classes c
   where c.class_id = x.class_id
     and c.class_code in ('7A1/Pe', '7C1/Pe', '7G1/Pe')
     and exists (select 1 from student_class y
                   join classes c2 on c2.class_id = y.class_id
                  where y.student_id = x.student_id
                    and c2.class_code = '7L1/Pe');
  get diagnostics n = row_count;
  if n <> 12 then
    raise exception 'expected to remove 12 old PE enrolments, matched %', n;
  end if;
end $$;
