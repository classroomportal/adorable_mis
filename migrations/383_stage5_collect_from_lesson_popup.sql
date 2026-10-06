-- Migration 383: when a teacher gives a student a Stage 5 (a serious
-- behaviour event) during their own lesson or Other Half activity, the
-- school office gets a pop-up telling them to go and collect the student
-- from that lesson.
--
-- Why (the principal, 6 Oct 2026): "when a student is awarded a stage 5 in
-- the class or other half - the office need to be told to go and collect the
-- student from the lesson and again another pop up - perhaps use a different
-- colour so the pop up is not confused." The office already gets a red pop-up
-- for a student missing from a lesson (309); this one is purple
-- (app/components/Stage5CollectionAlerts.js) and says "collect", not "find".
--
-- The rule (stage5_collection_alert_on_event(), after insert, and after a
-- change of points, category or type, on behaviour_events): a negative,
-- not-voided event at or below behaviour_rules.serious_event_points, dated
-- today, logged by a member of staff who is teaching that student right now:
--   - a lesson (timetable slot of one of the student's classes, joined by
--     today) in the period running now, taught by the logger: the lesson's
--     own teacher (182), the class's, or the cover teacher (374) where the
--     lesson is covered; or
--   - the student's Other Half activity at the OH period running now, with
--     the logger one of its staff.
-- "Right now" is between the period's start and end, in term. A Stage 5
-- logged later about something earlier, or by someone not teaching the
-- student at that moment, raises nothing: the student is somewhere else
-- by then, and the office would be sent to the wrong room.
-- The lesson, room and teacher are stored when the event is logged, since
-- "now" moves on. One alert per event, ever (an event moved down and back
-- up again doesn't raise a second).
--
-- The pop-up shows today's alerts nobody has acted on yet, while the event
-- is still serious and not voided (an event deleted by SMT takes its alert
-- with it). "Going to collect" (acknowledge_stage5_collection()) records who
-- and when and clears it from every office screen.
--
-- Who gets it: roles granted the new resource
-- /office/stage5-collection-alerts at /admin/permissions (school_office to
-- start with), checked against roles directly like 309, so admin alone
-- doesn't get pop-ups on every page.
--
-- The teacher who logged it is told on the Log behaviour page that the
-- office has been asked (stage5_collection_requested(), for the caller's own
-- events only).
--
-- The table is read and written only through these functions (RLS on, no
-- policies, no grants), like missed_lesson_alert_acks (309). The trigger
-- never stops an event being saved: any error inside it is turned into a
-- warning.

set local formwork.change_note = 'Principal (direct)';

create table public.stage5_collection_alerts (
  id bigint generated always as identity primary key,
  event_id integer not null references public.behaviour_events (event_id) on delete cascade,
  student_id integer not null references public.students (student_id),
  alert_date date not null,
  period_number integer not null references public.periods (period_number),
  lesson text,
  room text,
  logged_by_staff_id integer references public.staff (staff_id),
  logged_by_name text,
  created_at timestamptz not null default now(),
  acknowledged_by uuid,
  acknowledged_by_name text,
  acknowledged_at timestamptz,
  note text
);
-- One alert per event. A unique index, not a constraint (see 306).
create unique index stage5_collection_alerts_event on public.stage5_collection_alerts (event_id);
create index stage5_collection_alerts_date on public.stage5_collection_alerts (alert_date);

alter table public.stage5_collection_alerts enable row level security;
revoke all on public.stage5_collection_alerts from anon, authenticated;

insert into public.resources (resource_key, label, section, sort_order)
values ('/office/stage5-collection-alerts', 'Stage 5 collection pop-ups (no page: turns the office pop-up on)', 'Pastoral', 21)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
values ('school_office', '/office/stage5-collection-alerts')
on conflict do nothing;

create or replace function public.receives_stage5_collection_alerts()
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
       and rp.resource_key = '/office/stage5-collection-alerts'
  );
$$;

revoke execute on function public.receives_stage5_collection_alerts() from public, anon;
grant execute on function public.receives_stage5_collection_alerts() to authenticated;

-- The lesson or OH activity p_staff_id is teaching p_student_id in at school
-- time p_at, if any. Internal (the trigger, and testing with a past time).
create or replace function public.stage5_lesson_at(p_student_id integer, p_staff_id integer, p_at timestamp)
returns table (period_number integer, lesson text, room text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with t as (
    select p_at::date as d, to_char(p_at::date, 'Dy') as dy
  ), p as (
    select sd.period_number, sd.short_label
      from school_day sd, t
     where sd.day_of_week = t.dy
       and p_at >= t.d + sd.start_time
       and p_at < t.d + sd.end_time
       and exists (select 1 from terms tm where t.d between tm.start_date and tm.end_date)
  )
  select x.period_number, x.lesson, x.room
    from (
      select p.period_number, c.class_code as lesson,
             nullif(coalesce(ts.room, c.room), '') as room, 1 as pref
        from p, t
        join student_class sc on sc.student_id = p_student_id and coalesce(sc.joined_on, t.d) <= t.d
        join timetable_slots ts on ts.class_id = sc.class_id and ts.day_of_week = t.dy
        join classes c on c.class_id = sc.class_id
        left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
                                  and lc.cover_date = t.d and lc.cancelled_at is null
       where ts.period_number = p.period_number
         and coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id) = p_staff_id
      union all
      select p.period_number, 'Other Half: ' || a.activity_name, nullif(a.room, ''), 2
        from p, t
        join other_half_choices ch on ch.student_id = p_student_id
        join other_half_activities a on a.activity_id = ch.activity_id
        join terms tm on tm.term_id = a.term_id
        join other_half_activity_staff s on s.activity_id = a.activity_id and s.staff_id = p_staff_id
       where p.short_label = 'OH'
         and a.is_active
         and a.day_of_week = t.dy
         and t.d between tm.start_date and tm.end_date
    ) x
   order by x.pref
   limit 1;
$$;

revoke execute on function public.stage5_lesson_at(integer, integer, timestamp) from public, anon, authenticated;

create or replace function public.stage5_collection_alert_on_event()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_les record;
begin
  begin
    if new.type <> 'negative' or new.voided_at is not null or new.staff_id is null
       or new.points is null or new.event_date <> school_today()
       or new.points > (select serious_event_points from behaviour_rules limit 1)
       or exists (select 1 from stage5_collection_alerts k where k.event_id = new.event_id)
    then
      return null;
    end if;

    select * into v_les from stage5_lesson_at(new.student_id, new.staff_id, school_now());
    if v_les.period_number is null then
      return null;
    end if;

    insert into stage5_collection_alerts
      (event_id, student_id, alert_date, period_number, lesson, room, logged_by_staff_id, logged_by_name)
    select new.event_id, new.student_id, school_today(), v_les.period_number, v_les.lesson, v_les.room,
           new.staff_id, st.first_name || ' ' || st.last_name
      from staff st where st.staff_id = new.staff_id
    on conflict (event_id) do nothing;
  exception when others then
    -- Never stop a behaviour event being saved because of the pop-up.
    raise warning 'Stage 5 collection alert not raised for event %: %', new.event_id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.stage5_collection_alert_on_event() from public, anon, authenticated;

create trigger trg_stage5_collection_alert
  after insert or update of points, category, type on public.behaviour_events
  for each row
  when (new.type = 'negative')
  execute function public.stage5_collection_alert_on_event();

-- What the pop-up calls every minute. Null for anyone who doesn't receive
-- these alerts, so their page stops asking.
create or replace function public.office_stage5_collection_alerts()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not receives_stage5_collection_alerts() then
    return null;
  end if;
  return coalesce(
    (select json_agg(json_build_object(
              'id', k.id, 'event_id', k.event_id, 'student_id', k.student_id,
              'first_name', s.first_name, 'last_name', s.last_name, 'preferred_name', s.preferred_name,
              'year_group', s.year_group, 'form_class', s.form_class, 'boarding_house', s.boarding_house,
              'period_name', sd.period_name, 'start_time', sd.start_time, 'end_time', sd.end_time,
              'lesson', k.lesson, 'room', k.room, 'logged_by', k.logged_by_name,
              'category', e.category, 'points', e.points, 'description', e.description,
              'minutes_ago', (extract(epoch from (now() - k.created_at)) / 60)::integer)
              order by k.created_at)
       from stage5_collection_alerts k
       join behaviour_events e on e.event_id = k.event_id
       join students s on s.student_id = k.student_id
       left join school_day sd on sd.day_of_week = to_char(k.alert_date, 'Dy') and sd.period_number = k.period_number
      where k.alert_date = school_today()
        and k.acknowledged_at is null
        and e.voided_at is null
        and e.type = 'negative'
        and e.points <= (select serious_event_points from behaviour_rules limit 1)),
    '[]'::json);
end;
$$;

revoke execute on function public.office_stage5_collection_alerts() from public, anon;
grant execute on function public.office_stage5_collection_alerts() to authenticated;

create or replace function public.acknowledge_stage5_collection(p_alert_id bigint, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not receives_stage5_collection_alerts() then
    raise exception 'You do not receive Stage 5 collection alerts';
  end if;
  -- Already taken by someone else: nothing to do.
  update stage5_collection_alerts
     set acknowledged_by = auth.uid(),
         acknowledged_by_name = profile_display_name(auth.uid()),
         acknowledged_at = now(),
         note = nullif(btrim(p_note), '')
   where id = p_alert_id
     and acknowledged_at is null;
end;
$$;

revoke execute on function public.acknowledge_stage5_collection(bigint, text) from public, anon;
grant execute on function public.acknowledge_stage5_collection(bigint, text) to authenticated;

-- Which of these events (logged by the caller) have asked the office to
-- collect the student. Lets Log behaviour say so; reveals nothing about
-- anyone else's events.
create or replace function public.stage5_collection_requested(p_event_ids integer[])
returns integer[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(k.event_id), '{}')
    from stage5_collection_alerts k
    join profiles p on p.id = auth.uid() and p.staff_id = k.logged_by_staff_id
   where k.event_id = any (p_event_ids);
$$;

revoke execute on function public.stage5_collection_requested(integer[]) from public, anon;
grant execute on function public.stage5_collection_requested(integer[]) to authenticated;
