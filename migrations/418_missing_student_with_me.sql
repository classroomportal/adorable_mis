-- Migration 418: "They're with me" on the missing-student pop-up.
--
-- Why (the principal, 9 Oct 2026): "When the box flashes about a missing
-- child if the person responds they are with me please record C and name of
-- teacher on note." The all-staff pop-up (382) only offered "I've sent them"
-- and "Not with me"; a teacher who had kept the student (a detention, a
-- catch-up, a conversation) had no way to say so, and the register stayed N.
--
-- Now:
--   1. respond_missing_student_alert() takes a third answer, 'with_me'. It
--      changes the absent (N/O) mark for that lesson to C (Other authorised
--      absence), stamps staff_id with the member of staff who answered (so
--      the register and Change History show who gave the C), and puts
--      "With <name>" in attendance.notes, followed by anything they typed.
--      Any note already on the mark is kept in front. Once the mark is C the
--      alert no longer matches (status is no longer absent), so it leaves
--      every screen, the office's included; the answer stays in
--      missing_student_alert_responses.
--   2. record_missed_lesson_negatives() (416) leaves out a C given this way:
--      the student was with a member of staff, not truanting (the
--      principal's choice). Only the C branch is exempt: if the mark is later
--      changed back to N/O, the usual rule applies.
--   3. If the C is later changed to another code, the "With <name>" note is
--      cleared with it (trg_attendance_clear_with_me_note), so an N never
--      carries a note saying the student was with someone.
--
-- The registers show the note under the mark, read-only (app change with
-- this migration). Every mark already had a notes column; nothing showed it.
--
-- Applied through the connector in two parts: 418 (sections 1 and 3) and
-- 418b (section 2).

set local formwork.change_note = 'Principal (direct)';

alter table public.missing_student_alert_responses
  drop constraint if exists missing_student_alert_responses_response_check;
alter table public.missing_student_alert_responses
  add constraint missing_student_alert_responses_response_check
  check (response in ('sent', 'not_with_me', 'with_me'));

-- 1. The answer ------------------------------------------------------------------------------
create or replace function public.respond_missing_student_alert(
  p_student_id integer, p_period_number integer, p_response text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_staff_id integer := missing_student_alert_staff_id();
  v_name text;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_staff_id is null then
    raise exception 'Only staff can answer missing-student alerts';
  end if;
  if p_response not in ('sent', 'not_with_me', 'with_me') then
    raise exception 'Unknown answer';
  end if;
  if not exists (
    select 1 from missing_student_alerts_raw() r
     where r.student_id = p_student_id and r.period_number = p_period_number
  ) then
    -- The mark has been corrected since the pop-up appeared: nothing to answer.
    return;
  end if;

  v_name := profile_display_name(auth.uid());

  insert into missing_student_alert_responses
    (student_id, alert_date, period_number, staff_id, staff_name, response, note, responded_by)
  values
    (p_student_id, school_today(), p_period_number, v_staff_id, v_name,
     p_response, v_note, auth.uid())
  on conflict (student_id, alert_date, period_number, staff_id) do update
    set response = excluded.response, note = excluded.note,
        staff_name = excluded.staff_name, responded_by = excluded.responded_by,
        responded_at = now();

  if p_response = 'with_me' then
    update attendance a
       set code = 'C',
           status = 'authorized_absence',
           minutes_late = null,
           staff_id = v_staff_id,
           notes = concat_ws(' · ', nullif(btrim(a.notes), ''),
                             'With ' || coalesce(v_name, 'a member of staff')
                               || coalesce(': ' || v_note, ''))
     where a.student_id = p_student_id
       and a.attend_date = school_today()
       and a.period_number = p_period_number
       and a.status = 'absent';
  end if;
end;
$$;

revoke execute on function public.respond_missing_student_alert(integer, integer, text, text) from public, anon;
grant execute on function public.respond_missing_student_alert(integer, integer, text, text) to authenticated;

-- "I've sent them" and "They're with me" both clear the pop-up for everyone.
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
             and (x.response in ('sent', 'with_me') or x.staff_id = v_staff_id))),
    '[]'::json);
end;
$$;

revoke execute on function public.staff_missing_student_alerts() from public, anon;
grant execute on function public.staff_missing_student_alerts() to authenticated;

-- 2. No missed-lesson negative for a C given by "They're with me" -----------------------------
create or replace function public.record_missed_lesson_negatives()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := school_today();
  v_dy text := to_char(school_today(), 'Dy');
  v_now timestamp := school_now();
  v_category text;
  v_points integer;
  v_event_id integer;
  v_link_id bigint;
  v_count integer := 0;
  m record;
begin
  if v_today < date '2026-10-08' then
    return 0;
  end if;
  if not exists (select 1 from terms tm where v_today between tm.start_date and tm.end_date) then
    return 0;
  end if;

  select name, default_points into v_category, v_points
    from behaviour_categories
   where name = 'Missing a lesson activity' and type = 'negative' and not retired;
  if v_category is null or v_points is null then
    return 0;
  end if;

  for m in
    select a.attendance_id, a.student_id, a.period_number, a.code, sd.period_name, sd.start_time,
           ac.description as code_description,
           marker.first_name || ' ' || marker.last_name as marked_by,
           oha.activity_name,
           les.class_id, les.class_code
      from attendance a
      join school_day sd on sd.day_of_week = v_dy and sd.period_number = a.period_number
      join students s on s.student_id = a.student_id and s.status = 'active' and not s.is_demo
      left join attendance_codes ac on ac.code = a.code
      left join staff marker on marker.staff_id = a.staff_id
      left join other_half_activities oha on oha.activity_id = a.other_half_activity_id
      left join lateral (
        select c.class_id, c.class_code
          from student_class sc
          join timetable_slots ts on ts.class_id = sc.class_id
                                  and ts.day_of_week = v_dy
                                  and ts.period_number = a.period_number
          join classes c on c.class_id = sc.class_id
         where sc.student_id = a.student_id
           and a.other_half_activity_id is null
         order by c.class_code
         limit 1
      ) les on true
     where a.attend_date = v_today
       and not a.is_demo
       and coalesce(sd.short_label, '') <> 'M'
       and v_now >= v_today + sd.end_time
       and (
         (a.status = 'absent'
          and exists (
            select 1 from attendance e
             where e.student_id = a.student_id and e.attend_date = v_today
               and e.status in ('present', 'late')))
         or
         (a.code = 'C'
          and exists (
            select 1 from attendance e
             where e.student_id = a.student_id and e.attend_date = v_today
               and e.period_number > a.period_number
               and e.status in ('present', 'late'))
          -- 418: a member of staff answered "They're with me".
          and not exists (
            select 1 from missing_student_alert_responses w
             where w.student_id = a.student_id and w.alert_date = v_today
               and w.period_number = a.period_number and w.response = 'with_me'))
       )
       and not exists (
         select 1 from missed_lesson_negatives k
          where k.student_id = a.student_id and k.attend_date = v_today
            and k.period_number = a.period_number
       )
     order by a.student_id, sd.start_time
  loop
    insert into behaviour_events
      (student_id, staff_id, event_date, event_time, type, category, points, description, class_id)
    values
      (m.student_id, null, v_today, m.start_time, 'negative', v_category, v_points,
       'Recorded automatically: marked ' || coalesce(m.code_description, 'absent')
         || ' at ' || coalesce(m.period_name, 'period ' || m.period_number)
         || coalesce(' (' || coalesce('Other Half: ' || m.activity_name, m.class_code) || ')', '')
         || coalesce(' by ' || m.marked_by, '')
         || case when m.code = 'C'
                 then ', then marked present or late at a later lesson that day.'
                 else ', having been marked present or late at another period that day.' end,
       m.class_id)
    returning event_id into v_event_id;

    insert into missed_lesson_negatives (student_id, attend_date, period_number, attendance_id, event_id)
    values (m.student_id, v_today, m.period_number, m.attendance_id, v_event_id)
    on conflict (student_id, attend_date, period_number) do nothing
    returning id into v_link_id;

    if v_link_id is not null then
      begin
        perform notify_missed_lesson_negative(v_link_id);
      exception when others then
        raise warning 'Missed-lesson notice not sent for event %: %', v_event_id, sqlerrm;
      end;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.record_missed_lesson_negatives() from public, anon, authenticated;

-- 3. The note goes when the C goes -------------------------------------------------------------
create or replace function public.attendance_clear_with_me_note()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if old.code = 'C' and new.code is distinct from 'C'
     and new.notes is not distinct from old.notes
     and exists (
       select 1 from missing_student_alert_responses w
        where w.student_id = old.student_id and w.alert_date = old.attend_date
          and w.period_number = old.period_number and w.response = 'with_me')
  then
    new.notes := nullif(btrim(regexp_replace(old.notes, '(^| · )With [^·]*$', '')), '');
  end if;
  return new;
end;
$$;

revoke execute on function public.attendance_clear_with_me_note() from public, anon, authenticated;

create trigger trg_attendance_clear_with_me_note
  before update of code on public.attendance
  for each row execute function public.attendance_clear_with_me_note();
