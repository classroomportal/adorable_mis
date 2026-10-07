-- Migration 392: a Stage 5 given during prep sends the purple "collect"
-- pop-up to the Head of Boarding.
--
-- Why (the principal, 7 Oct 2026): two Stage 5s logged by a houseparent for
-- a Year 10 boarder on 5 and 6 Oct raised no pop-up, because migration 383
-- only raises one when the person logging it is teaching the student in a
-- lesson or Other Half activity at that moment. Prep isn't a lesson, so
-- nobody was told. "Add that it should be sent to HOB if during prep." The
-- head_of_boarding role was given to two people the same day (boys' and
-- girls' heads of boarding).
--
-- The rule, added to stage5_collection_alert_on_event(): when no lesson
-- matches, a serious event dated today and logged (by anyone) while the
-- student's own year group is in prep raises a 'prep' alert. "In prep"
-- means today is one of the year's prep days, the time is between
-- prep_starts and prep_ends (prep_settings, /pastoral/prep), and prep runs
-- that evening at all (prep_minutes_for() > 0: in term, not a holiday, not
-- a blocked day such as mocks). Lesson alerts are unchanged.
--
-- Who gets which:
--   * 'lesson' alerts: as before, roles granted /office/stage5-collection-
--     alerts (the school office);
--   * 'prep' alerts: holders of head_of_boarding, checked in staff_roles
--     directly (has_staff_role(), so an admin login alone doesn't get them).
--     The office isn't open during prep, so it doesn't get these.
-- Both see the same purple pop-up, which says "from prep" for a prep alert;
-- either Head of Boarding pressing "Going to collect" clears it for both.
--
-- stage5_collection_alerts gets `kind` ('lesson' / 'prep'); a prep alert
-- has no period. stage5_collection_requested() is unchanged; the new
-- stage5_collection_requested_kinds() lets Log behaviour say who was asked.

-- Numbered 388 when written and applied (7 Oct 2026); renumbered 392 because
-- the automatic missed-lesson negative applied earlier that day already used 388.

set local formwork.change_note = 'Principal (direct)';

alter table public.stage5_collection_alerts
  add column kind text not null default 'lesson',
  alter column period_number drop not null;

alter table public.stage5_collection_alerts
  add constraint stage5_collection_alerts_kind_check
  check (kind in ('lesson', 'prep') and (kind = 'prep' or period_number is not null));

-- Is the student's year group in prep at school time p_at? Internal.
create or replace function public.stage5_in_prep_at(p_student_id integer, p_at timestamp)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from students s
      join prep_settings ps on ps.year_group = s.year_group
     where s.student_id = p_student_id
       and to_char(p_at::date, 'Dy') = any (ps.prep_days)
       and p_at::time >= ps.prep_starts
       and p_at::time < ps.prep_ends
  ) and prep_minutes_for(p_student_id, p_at::date) > 0;
$$;

revoke execute on function public.stage5_in_prep_at(integer, timestamp) from public, anon, authenticated;

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
    if v_les.period_number is not null then
      insert into stage5_collection_alerts
        (event_id, student_id, alert_date, period_number, lesson, room, logged_by_staff_id, logged_by_name, kind)
      select new.event_id, new.student_id, school_today(), v_les.period_number, v_les.lesson, v_les.room,
             new.staff_id, st.first_name || ' ' || st.last_name, 'lesson'
        from staff st where st.staff_id = new.staff_id
      on conflict (event_id) do nothing;
    -- Migration 392: during prep, the Head of Boarding collects.
    elsif stage5_in_prep_at(new.student_id, school_now()) then
      insert into stage5_collection_alerts
        (event_id, student_id, alert_date, period_number, lesson, room, logged_by_staff_id, logged_by_name, kind)
      select new.event_id, new.student_id, school_today(), null, 'Prep', null,
             new.staff_id, st.first_name || ' ' || st.last_name, 'prep'
        from staff st where st.staff_id = new.staff_id
      on conflict (event_id) do nothing;
    end if;
  exception when others then
    -- Never stop a behaviour event being saved because of the pop-up.
    raise warning 'Stage 5 collection alert not raised for event %: %', new.event_id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.stage5_collection_alert_on_event() from public, anon, authenticated;

-- Which kinds of alert the caller receives.
create or replace function public.my_stage5_alert_kinds()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select array_remove(array[
    case when receives_stage5_collection_alerts() then 'lesson' end,
    case when has_staff_role(array['head_of_boarding']) then 'prep' end
  ], null);
$$;

revoke execute on function public.my_stage5_alert_kinds() from public, anon;
grant execute on function public.my_stage5_alert_kinds() to authenticated;

create or replace function public.office_stage5_collection_alerts()
returns json
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_kinds text[] := my_stage5_alert_kinds();
begin
  if cardinality(v_kinds) = 0 then
    return null;
  end if;
  return coalesce(
    (select json_agg(json_build_object(
              'id', k.id, 'event_id', k.event_id, 'student_id', k.student_id, 'kind', k.kind,
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
        and k.kind = any (v_kinds)
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
  if not exists (
    select 1 from stage5_collection_alerts k
     where k.id = p_alert_id and k.kind = any (my_stage5_alert_kinds())
  ) then
    raise exception 'You do not receive this Stage 5 collection alert';
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

-- Like stage5_collection_requested(), with the kind, so Log behaviour can
-- say whether the office or the Head of Boarding was asked. The caller's
-- own events only.
create or replace function public.stage5_collection_requested_kinds(p_event_ids integer[])
returns table (event_id integer, kind text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select k.event_id, k.kind
    from stage5_collection_alerts k
    join profiles p on p.id = auth.uid() and p.staff_id = k.logged_by_staff_id
   where k.event_id = any (p_event_ids);
$$;

revoke execute on function public.stage5_collection_requested_kinds(integer[]) from public, anon;
grant execute on function public.stage5_collection_requested_kinds(integer[]) to authenticated;
