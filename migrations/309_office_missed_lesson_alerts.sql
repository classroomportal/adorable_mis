-- Migration 309: pop-up on the school office's screens when a student who
-- was in school earlier is missing from a lesson.
--
-- Why (the principal, 1 Oct 2026, after Missed Lessons, 307–308): "Could we
-- use some of this logic to flash up on the office screen ... that someone is
-- not in their lesson despite being marked earlier, after 15 mins." Missed
-- Lessons is a list someone has to open; the office needs to be told while
-- the lesson is still going, so someone can go and find the student.
--
-- The rule (office_missed_lesson_alerts()): today, at any period that started
-- at least 15 minutes ago (the same grace as Registers Not Done, so a student
-- who turns up a few minutes late and is marked late never raises one), an
-- active student who:
--   - is marked absent without a reason (status 'absent': codes N and O) at
--     that period, and
--   - was marked present or late at an earlier period today.
-- Nothing is stored until someone deals with it: the pop-up is worked out
-- each time it is asked for, so if the teacher corrects the mark to present
-- or late, or to an authorised absence, the alert disappears by itself.
--
-- "Seen" (acknowledge_missed_lesson_alert()) writes one row to
-- missed_lesson_alert_acks for that student and period, with who and when,
-- and the alert goes from every office screen. It only accepts an alert that
-- is live at that moment.
--
-- Who gets the pop-up: anyone holding a role granted the new resource
-- /office/missed-lesson-alerts at /admin/permissions (school_office to start
-- with). It is checked against roles directly, not with has_resource_access(),
-- so an admin login doesn't get pop-ups on every page just for being admin;
-- give the admin's staff record a granted role if they should. The resource
-- has no page of its own; it is only the switch.
--
-- The acks table is read and written only through these functions (RLS on,
-- no policies, no grants).

set local formwork.change_note = 'Principal (direct)';

create table public.missed_lesson_alert_acks (
  id bigint generated always as identity primary key,
  student_id integer not null references public.students (student_id),
  alert_date date not null,
  period_number integer not null references public.periods (period_number),
  acknowledged_by uuid,
  acknowledged_by_name text,
  acknowledged_at timestamptz not null default now(),
  note text
);
-- One "seen" per student per period per day. A unique index, not a
-- constraint, so PostgREST never reads the table as a junction (see 306).
create unique index missed_lesson_alert_acks_key
  on public.missed_lesson_alert_acks (student_id, alert_date, period_number);

alter table public.missed_lesson_alert_acks enable row level security;
revoke all on public.missed_lesson_alert_acks from anon, authenticated;

insert into public.resources (resource_key, label, section, sort_order)
values ('/office/missed-lesson-alerts', 'Missed-lesson pop-ups (no page: turns the office pop-up on)', 'Pastoral', 20)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
values ('school_office', '/office/missed-lesson-alerts')
on conflict do nothing;

create or replace function public.receives_missed_lesson_alerts()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from profiles p
      join staff_roles sr on sr.staff_id = p.staff_id
      join role_permissions rp on rp.role_name = sr.role_name
     where p.id = auth.uid()
       and rp.resource_key = '/office/missed-lesson-alerts'
  );
$$;

-- The live alerts, as rows. Used by both functions below; not callable from
-- the app on its own.
create or replace function public.missed_lesson_alerts_live()
returns table (
  student_id integer, period_number integer, period_name text, short_label text,
  start_time time, minutes_since_start integer,
  first_name text, last_name text, preferred_name text, year_group integer,
  form_class text, boarding_house text,
  code text, marked_by text, lesson text, teacher text, room text,
  last_seen_period text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with today as (
    select school_today() as d, to_char(school_today(), 'Dy') as dy, school_now() as now_ts
  ), periods_due as (
    select sd.period_number, sd.period_name, sd.short_label, sd.start_time
      from school_day sd, today t
     where sd.day_of_week = t.dy
       and t.now_ts >= t.d + sd.start_time + interval '15 minutes'
       and exists (select 1 from terms tm where t.d between tm.start_date and tm.end_date)
  )
  select a.student_id, pd.period_number, pd.period_name, pd.short_label, pd.start_time,
         (extract(epoch from (t.now_ts - (t.d + pd.start_time))) / 60)::integer,
         s.first_name, s.last_name, s.preferred_name, s.year_group, s.form_class, s.boarding_house,
         ac.description,
         marker.first_name || ' ' || marker.last_name,
         coalesce('Other Half: ' || oha.activity_name, les.lesson),
         les.teacher,
         coalesce(oha.room, les.room),
         seen.period_name
    from today t
    join periods_due pd on true
    join attendance a on a.attend_date = t.d and a.period_number = pd.period_number and a.status = 'absent'
    join students s on s.student_id = a.student_id and s.status = 'active' and not s.is_demo
    left join attendance_codes ac on ac.code = a.code
    left join staff marker on marker.staff_id = a.staff_id
    left join other_half_activities oha on oha.activity_id = a.other_half_activity_id
    -- Where they were last seen: their latest present/late mark before this period.
    join lateral (
      select sd2.period_name
        from attendance e
        join school_day sd2 on sd2.day_of_week = t.dy and sd2.period_number = e.period_number
       where e.student_id = a.student_id and e.attend_date = t.d
         and e.status in ('present', 'late')
         and sd2.start_time < pd.start_time
       order by sd2.start_time desc
       limit 1
    ) seen on true
    -- The lesson they should be in, with the lesson's own teacher and room first (182).
    left join lateral (
      select string_agg(distinct c.class_code, ', ') as lesson,
             string_agg(distinct (st.first_name || ' ' || st.last_name), ', ') as teacher,
             string_agg(distinct nullif(coalesce(ts.room, c.room), ''), ', ') as room
        from student_class sc
        join timetable_slots ts on ts.class_id = sc.class_id
                                and ts.day_of_week = t.dy
                                and ts.period_number = pd.period_number
        join classes c on c.class_id = sc.class_id
        left join staff st on st.staff_id = coalesce(ts.staff_id, c.staff_id)
       where sc.student_id = a.student_id
    ) les on true
   where not exists (
     select 1 from missed_lesson_alert_acks k
      where k.student_id = a.student_id and k.alert_date = t.d and k.period_number = pd.period_number
   );
$$;

revoke execute on function public.missed_lesson_alerts_live() from public, anon, authenticated;

-- What the pop-up calls every minute. Null for anyone who doesn't receive
-- alerts, so their page stops asking.
create or replace function public.office_missed_lesson_alerts()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not receives_missed_lesson_alerts() then
    return null;
  end if;
  return coalesce(
    (select json_agg(row_to_json(x) order by x.start_time desc, x.year_group, x.last_name)
       from missed_lesson_alerts_live() x),
    '[]'::json);
end;
$$;

revoke execute on function public.office_missed_lesson_alerts() from public, anon;
grant execute on function public.office_missed_lesson_alerts() to authenticated;

create or replace function public.acknowledge_missed_lesson_alert(
  p_student_id integer, p_period_number integer, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not receives_missed_lesson_alerts() then
    raise exception 'You do not receive missed-lesson alerts';
  end if;
  if not exists (
    select 1 from missed_lesson_alerts_live() x
     where x.student_id = p_student_id and x.period_number = p_period_number
  ) then
    -- Already seen by someone else, or the mark has been corrected.
    return;
  end if;
  insert into missed_lesson_alert_acks
    (student_id, alert_date, period_number, acknowledged_by, acknowledged_by_name, note)
  values
    (p_student_id, school_today(), p_period_number, auth.uid(), profile_display_name(auth.uid()),
     nullif(btrim(p_note), ''))
  on conflict (student_id, alert_date, period_number) do nothing;
end;
$$;

revoke execute on function public.acknowledge_missed_lesson_alert(integer, integer, text) from public, anon;
grant execute on function public.acknowledge_missed_lesson_alert(integer, integer, text) to authenticated;
