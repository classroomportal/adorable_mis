-- Migration 382: when the office gets a missed-lesson pop-up (309), every
-- member of staff gets one too, asking "Do you know where this student is?
-- If so, please send them to <lesson>, room <room>". The office's pop-up now
-- shows the student's whole day of marks (which teacher marked them present
-- or absent at each period) and what staff have answered.
--
-- Why (the principal, 6 Oct 2026): "when a student is missing a lesson and
-- the office has a pop up - there needs to be an immediate pop up on all
-- screens - do you know where this child is - if so please send them to ...
-- correct lesson. likewise the office needs to see which teachers have
-- marked the student present or absent when their pop comes."
--
-- The rule for an alert is unchanged (309): today, a period that started at
-- least 15 minutes ago, an active student marked absent without a reason
-- (N/O) there after being marked present or late earlier today. The base
-- query moves into missing_student_alerts_raw(), which also returns alerts
-- the office has already pressed "Seen" on, the absent mark's staff_id, the
-- period's end and the OH staff; missed_lesson_alerts_live() keeps its shape
-- and becomes "raw, not yet seen", so the office pop-up behaves as before.
-- The teacher shown is now the cover teacher where the lesson is covered
-- (374), and an Other Half activity shows its staff.
--
-- The staff pop-up (staff_missing_student_alerts()):
--   - goes to every signed-in member of staff (a staff record and a staff or
--     admin profile), except those who get the office pop-up (they have
--     their own) and the person who marked the student absent (they know);
--   - lasts until the period ends, not until the office presses "Seen":
--     the office usually presses it straight away, which would take it off
--     everyone's screen before anyone had read it;
--   - clears for everyone when a member of staff answers "I've sent them",
--     or the mark is corrected (present, late or an authorised code);
--   - clears for one person when they answer "Not with me".
-- Answers are kept in missing_student_alert_responses (who, when, where the
-- student was), written only through respond_missing_student_alert(). The
-- table has RLS on, no policies and no grants, like the acks table (309).
--
-- The day of marks (missing_student_day_marks()) is every period today that
-- has started, with the student's mark, the code, who marked it, and the
-- lesson and its teacher (cover first). Periods with a lesson but no mark
-- yet are included as "not taken". Shown only on the office pop-up.

set local formwork.change_note = 'Principal (direct)';

create table public.missing_student_alert_responses (
  id bigint generated always as identity primary key,
  student_id integer not null references public.students (student_id),
  alert_date date not null,
  period_number integer not null references public.periods (period_number),
  staff_id integer not null references public.staff (staff_id),
  staff_name text,
  response text not null check (response in ('sent', 'not_with_me')),
  note text,
  responded_by uuid,
  responded_at timestamptz not null default now()
);
-- One answer per person per alert (a second answer replaces the first). A
-- unique index, not a constraint, so PostgREST never reads it as a junction (306).
create unique index missing_student_alert_responses_key
  on public.missing_student_alert_responses (student_id, alert_date, period_number, staff_id);

alter table public.missing_student_alert_responses enable row level security;
revoke all on public.missing_student_alert_responses from anon, authenticated;

-- Every live alert, seen by the office or not. Internal.
create or replace function public.missing_student_alerts_raw()
returns table (
  student_id integer, period_number integer, period_name text, short_label text,
  start_time time, end_time time, minutes_since_start integer,
  first_name text, last_name text, preferred_name text, year_group integer,
  form_class text, boarding_house text,
  code text, marked_by text, marked_by_staff_id integer,
  lesson text, teacher text, room text,
  last_seen_period text, office_seen boolean
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with today as (
    select school_today() as d, to_char(school_today(), 'Dy') as dy, school_now() as now_ts
  ), periods_due as (
    select sd.period_number, sd.period_name, sd.short_label, sd.start_time, sd.end_time
      from school_day sd, today t
     where sd.day_of_week = t.dy
       and t.now_ts >= t.d + sd.start_time + interval '15 minutes'
       and exists (select 1 from terms tm where t.d between tm.start_date and tm.end_date)
  )
  select a.student_id, pd.period_number, pd.period_name, pd.short_label, pd.start_time, pd.end_time,
         (extract(epoch from (t.now_ts - (t.d + pd.start_time))) / 60)::integer,
         s.first_name, s.last_name, s.preferred_name, s.year_group, s.form_class, s.boarding_house,
         ac.description,
         marker.first_name || ' ' || marker.last_name,
         a.staff_id,
         coalesce('Other Half: ' || oha.activity_name, les.lesson),
         coalesce(ohs.teacher, les.teacher),
         coalesce(nullif(oha.room, ''), les.room),
         seen.period_name,
         exists (
           select 1 from missed_lesson_alert_acks k
            where k.student_id = a.student_id and k.alert_date = t.d and k.period_number = pd.period_number
         )
    from today t
    join periods_due pd on true
    join attendance a on a.attend_date = t.d and a.period_number = pd.period_number and a.status = 'absent'
    join students s on s.student_id = a.student_id and s.status = 'active' and not s.is_demo
    left join attendance_codes ac on ac.code = a.code
    left join staff marker on marker.staff_id = a.staff_id
    left join other_half_activities oha on oha.activity_id = a.other_half_activity_id
    left join lateral (
      select string_agg(st.first_name || ' ' || st.last_name, ', ' order by st.last_name) as teacher
        from other_half_activity_staff x
        join staff st on st.staff_id = x.staff_id
       where x.activity_id = oha.activity_id
    ) ohs on true
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
    -- The lesson they should be in: the cover teacher first (374), then the
    -- lesson's own teacher and room (182), then the class's.
    left join lateral (
      select string_agg(distinct c.class_code, ', ') as lesson,
             string_agg(distinct (st.first_name || ' ' || st.last_name), ', ') as teacher,
             string_agg(distinct nullif(coalesce(ts.room, c.room), ''), ', ') as room
        from student_class sc
        join timetable_slots ts on ts.class_id = sc.class_id
                                and ts.day_of_week = t.dy
                                and ts.period_number = pd.period_number
        join classes c on c.class_id = sc.class_id
        left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
                                  and lc.cover_date = t.d and lc.cancelled_at is null
        left join staff st on st.staff_id = coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id)
       where sc.student_id = a.student_id
    ) les on true;
$$;

revoke execute on function public.missing_student_alerts_raw() from public, anon, authenticated;

-- Same shape as before (309); now the not-yet-seen rows of the raw query.
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
  select r.student_id, r.period_number, r.period_name, r.short_label, r.start_time,
         r.minutes_since_start, r.first_name, r.last_name, r.preferred_name, r.year_group,
         r.form_class, r.boarding_house, r.code, r.marked_by, r.lesson, r.teacher, r.room,
         r.last_seen_period
    from missing_student_alerts_raw() r
   where not r.office_seen;
$$;

revoke execute on function public.missed_lesson_alerts_live() from public, anon, authenticated;

-- A student's marks today, period by period, for the office pop-up. Internal.
create or replace function public.missing_student_day_marks(p_student_id integer)
returns json
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with t as (
    select school_today() as d, to_char(school_today(), 'Dy') as dy, school_now() as now_ts
  )
  select coalesce(json_agg(row_to_json(x) order by x.start_time), '[]'::json)
    from (
      select sd.period_number, sd.period_name, sd.short_label, sd.start_time,
             coalesce(a.status, 'not_taken') as status,
             a.code,
             ac.description as code_description,
             marker.first_name || ' ' || marker.last_name as marked_by,
             coalesce('Other Half: ' || oha.activity_name, les.lesson) as lesson,
             les.teacher
        from t
        join school_day sd on sd.day_of_week = t.dy and t.now_ts >= t.d + sd.start_time
        left join attendance a on a.student_id = p_student_id and a.attend_date = t.d
                              and a.period_number = sd.period_number
        left join attendance_codes ac on ac.code = a.code
        left join staff marker on marker.staff_id = a.staff_id
        left join other_half_activities oha on oha.activity_id = a.other_half_activity_id
        left join lateral (
          select string_agg(distinct c.class_code, ', ') as lesson,
                 string_agg(distinct (st.first_name || ' ' || st.last_name), ', ') as teacher
            from student_class sc
            join timetable_slots ts on ts.class_id = sc.class_id
                                    and ts.day_of_week = t.dy
                                    and ts.period_number = sd.period_number
            join classes c on c.class_id = sc.class_id
            left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
                                      and lc.cover_date = t.d and lc.cancelled_at is null
            left join staff st on st.staff_id = coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id)
           where sc.student_id = p_student_id
        ) les on true
       where a.attendance_id is not null or les.lesson is not null
    ) x;
$$;

revoke execute on function public.missing_student_day_marks(integer) from public, anon, authenticated;

-- The office pop-up: as before, plus each alert's day of marks and the
-- staff answers so far.
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
    (select json_agg(
              (row_to_json(x)::jsonb
                || jsonb_build_object(
                     'day_marks', missing_student_day_marks(x.student_id),
                     'responses', (
                       select coalesce(jsonb_agg(jsonb_build_object(
                                'staff_name', r.staff_name, 'response', r.response,
                                'note', r.note, 'responded_at', r.responded_at)
                                order by r.responded_at), '[]'::jsonb)
                         from missing_student_alert_responses r
                        where r.student_id = x.student_id and r.alert_date = school_today()
                          and r.period_number = x.period_number)))::json
              order by x.start_time desc, x.year_group, x.last_name)
       from missed_lesson_alerts_live() x),
    '[]'::json);
end;
$$;

revoke execute on function public.office_missed_lesson_alerts() from public, anon;
grant execute on function public.office_missed_lesson_alerts() to authenticated;

-- The caller's staff record, if they are signed in as staff or admin.
create or replace function public.missing_student_alert_staff_id()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select p.staff_id from profiles p
   where p.id = auth.uid() and p.role in ('staff', 'admin') and p.staff_id is not null;
$$;

revoke execute on function public.missing_student_alert_staff_id() from public, anon, authenticated;

-- What the all-staff pop-up calls every minute. Null for anyone who isn't
-- staff or who gets the office pop-up, so their page stops asking.
create or replace function public.staff_missing_student_alerts()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_staff_id integer := missing_student_alert_staff_id();
begin
  if v_staff_id is null or receives_missed_lesson_alerts() then
    return null;
  end if;
  return coalesce(
    (select json_agg(json_build_object(
              'student_id', r.student_id, 'period_number', r.period_number,
              'period_name', r.period_name, 'start_time', r.start_time, 'end_time', r.end_time,
              'minutes_since_start', r.minutes_since_start,
              'first_name', r.first_name, 'last_name', r.last_name, 'preferred_name', r.preferred_name,
              'year_group', r.year_group, 'form_class', r.form_class, 'boarding_house', r.boarding_house,
              'lesson', r.lesson, 'teacher', r.teacher, 'room', r.room)
              order by r.start_time desc, r.year_group, r.last_name)
       from missing_student_alerts_raw() r
      where school_now() < school_today() + r.end_time
        and r.marked_by_staff_id is distinct from v_staff_id
        and not exists (
          select 1 from missing_student_alert_responses x
           where x.student_id = r.student_id and x.alert_date = school_today()
             and x.period_number = r.period_number
             and (x.response = 'sent' or x.staff_id = v_staff_id))),
    '[]'::json);
end;
$$;

revoke execute on function public.staff_missing_student_alerts() from public, anon;
grant execute on function public.staff_missing_student_alerts() to authenticated;

create or replace function public.respond_missing_student_alert(
  p_student_id integer, p_period_number integer, p_response text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_staff_id integer := missing_student_alert_staff_id();
begin
  if v_staff_id is null then
    raise exception 'Only staff can answer missing-student alerts';
  end if;
  if p_response not in ('sent', 'not_with_me') then
    raise exception 'Unknown answer';
  end if;
  if not exists (
    select 1 from missing_student_alerts_raw() r
     where r.student_id = p_student_id and r.period_number = p_period_number
  ) then
    -- The mark has been corrected since the pop-up appeared: nothing to answer.
    return;
  end if;
  insert into missing_student_alert_responses
    (student_id, alert_date, period_number, staff_id, staff_name, response, note, responded_by)
  values
    (p_student_id, school_today(), p_period_number, v_staff_id, profile_display_name(auth.uid()),
     p_response, nullif(btrim(p_note), ''), auth.uid())
  on conflict (student_id, alert_date, period_number, staff_id) do update
    set response = excluded.response, note = excluded.note,
        staff_name = excluded.staff_name, responded_by = excluded.responded_by,
        responded_at = now();
end;
$$;

revoke execute on function public.respond_missing_student_alert(integer, integer, text, text) from public, anon;
grant execute on function public.respond_missing_student_alert(integer, integer, text, text) to authenticated;
