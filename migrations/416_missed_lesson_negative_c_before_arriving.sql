-- Migration 416: a C before the student turns up counts as a missed lesson.
--
-- Why (the principal, 9 Oct 2026): "The routine for detentions should pick
-- up if the student was recorded C for part of the day and then the student
-- attended". Until now the record-missed-lesson-negatives routine (388) only
-- looked at N and O marks: a student down as C (Other authorised absence)
-- for the morning who then turned up in the afternoon got nothing. Chibuzor
-- MBAEZE (Y12) was C for lessons on 6-9 Oct and kept being seen in later
-- lessons.
--
-- The principal's choice, of three offered: only a C that comes BEFORE a
-- present or late mark later the same day (the student was "away", then
-- appeared). A C after the student's last present lesson (went home sick,
-- left for an appointment) is left alone. Period numbers run in time order
-- every day (389), so "later" is a higher period_number. Registration stays
-- out, as for N/O. Planned-absence C marks count too: an appointment the
-- student comes back from should carry its own code (M, I, E, H), not C.
--
-- Now:
--   1. record_missed_lesson_negatives() also picks C marks with a present
--      or late mark at a later period that day. Same −5 "Missing a lesson
--      activity" event, same once-per-(student, date, period) record, so
--      detention, alert and review follow as for N/O. From today on only;
--      earlier days aren't gone back over.
--   2. Withdrawing: changing the C to any code but N/O, or deleting it,
--      voids the event and cancels its not-yet-held detention, as
--      correcting an N/O does. A second trigger watches code (C's status,
--      authorized_absence, is shared with M/I/E/H), and the function now
--      also keeps the event when a C is saved as C again.
--   3. The notice: for a C it goes to the person who saved the mark, or, for
--      a planned-absence mark (no one saved it), the attendance officer(s),
--      worded for a C ("they turned up later; if they were away for a known
--      reason, give the matching code").

set local formwork.change_note = 'Principal (direct)';

-- 1. The routine ----------------------------------------------------------------------------
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
               and e.status in ('present', 'late')))
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

-- 2. Withdrawing ----------------------------------------------------------------------------
create or replace function public.withdraw_missed_lesson_negative()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link missed_lesson_negatives%rowtype;
  v_event behaviour_events%rowtype;
  v_week_start date;
  v_week_total integer;
  r behaviour_rules;
begin
  -- Still a missed lesson: still N/O, or a C saved as C again (416).
  if tg_op = 'UPDATE' and (new.status = 'absent' or (old.code = 'C' and new.code = 'C')) then
    return null;
  end if;

  select * into v_link from missed_lesson_negatives
   where attendance_id = old.attendance_id and withdrawn_at is null
   limit 1;
  if v_link.id is null then
    return null;
  end if;

  update missed_lesson_negatives set withdrawn_at = now() where id = v_link.id;

  update behaviour_events
     set voided_points = points, points = 0, voided_at = now()
   where event_id = v_link.event_id and voided_at is null
  returning * into v_event;

  if v_event.event_id is not null then
    select * into r from behaviour_rules where id;
    v_week_start := v_event.event_date - (((extract(dow from v_event.event_date)::int - 6 + 7) % 7));

    select coalesce(sum(points), 0) into v_week_total
      from behaviour_events
     where student_id = v_event.student_id and type = 'negative' and voided_at is null
       and event_date between v_week_start and v_week_start + 6;

    update detentions set status = 'cancelled'
     where status = 'scheduled'
       and detention_date >= school_today()
       and (behaviour_event_id = v_event.event_id
            or (v_week_total > r.detention_weekly_total_points
                and student_id = v_event.student_id
                and detention_date = v_week_start + 6
                and behaviour_event_id is null));
  end if;

  return null;
end;
$$;

create or replace trigger trg_withdraw_missed_lesson_negative_c
  after delete or update of code on public.attendance
  for each row when (old.code = 'C')
  execute function public.withdraw_missed_lesson_negative();

-- 3. The notice -----------------------------------------------------------------------------
create or replace function public.notify_missed_lesson_negative(p_link_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link missed_lesson_negatives%rowtype;
  a attendance%rowtype;
  v_student text;
  v_year integer;
  v_period text;
  v_lesson text;
  v_class_id integer;
  v_code text;
  v_staff integer[];
  v_emails text[];
  v_logins uuid[];
  v_detention date;
  v_url text;
  v_subject text;
  v_html text;
  v_dy text;
begin
  select * into v_link from missed_lesson_negatives where id = p_link_id;
  if v_link.id is null or v_link.notified_at is not null or v_link.withdrawn_at is not null then
    return;
  end if;
  select * into a from attendance where attendance_id = v_link.attendance_id;
  if a.attendance_id is null then
    return;
  end if;

  -- Who is asked: whoever saved the mark; for a C no one saved (a planned
  -- absence), the attendance officer(s).
  if a.staff_id is not null then
    v_staff := array[a.staff_id];
  elsif a.code = 'C' then
    select array_agg(distinct staff_id) into v_staff
      from staff_roles where role_name = 'attendance_officer';
  end if;
  if v_staff is null then
    return;
  end if;

  v_dy := to_char(v_link.attend_date, 'Dy');
  select coalesce(nullif(btrim(s.preferred_name), ''), s.first_name) || ' ' || s.last_name, s.year_group
    into v_student, v_year
    from students s where s.student_id = v_link.student_id;
  select coalesce(sd.period_name, p.period_name) into v_period
    from periods p left join school_day sd on sd.day_of_week = v_dy and sd.period_number = p.period_number
   where p.period_number = v_link.period_number;
  select description into v_code from attendance_codes where code = a.code;

  if a.other_half_activity_id is not null then
    select activity_name into v_lesson
      from other_half_activities where activity_id = a.other_half_activity_id;
    v_url := 'https://misform.work/other-half/register?activityId=' || a.other_half_activity_id
             || '&date=' || v_link.attend_date;
  else
    select c.class_id, c.class_code into v_class_id, v_lesson
      from student_class sc
      join timetable_slots ts on ts.class_id = sc.class_id and ts.day_of_week = v_dy
                              and ts.period_number = v_link.period_number
      join classes c on c.class_id = sc.class_id
     where sc.student_id = v_link.student_id
     order by c.class_code limit 1;
    v_url := 'https://misform.work/attendance?'
             || coalesce('classId=' || v_class_id || '&', '')
             || 'period=' || v_link.period_number || '&date=' || v_link.attend_date;
  end if;

  select min(detention_date) into v_detention from detentions where behaviour_event_id = v_link.event_id;

  select array_agg(distinct lower(btrim(email))) into v_emails
    from staff where staff_id = any(v_staff) and is_plain_email(lower(btrim(email)));
  select array_agg(id) into v_logins from profiles where staff_id = any(v_staff);

  if v_emails is null and v_logins is null then
    return;
  end if;

  if a.code = 'C' then
    v_subject := 'Please check: ' || v_student || ' was C at ' || coalesce(v_lesson, v_period) || ', then turned up';
    v_html := '<p><strong>' || html_escape(v_student) || '</strong>'
      || coalesce(' (Year ' || v_year || ')', '') || ' was marked <strong>C (' || html_escape(coalesce(v_code, 'Other authorised absence')) || ')</strong>'
      || ' at ' || html_escape(coalesce(v_period, 'period ' || v_link.period_number))
      || coalesce(' (' || html_escape(v_lesson) || ')', '')
      || ' on ' || to_char(v_link.attend_date, 'FMDay FMDD FMMonth YYYY')
      || case when a.planned_absence_id is not null then ', from a planned absence' else '' end || '.</p>'
      || '<p>They were then marked present or late at a later lesson that day, so Formwork has recorded a '
      || '<strong>−5 "Missing a lesson activity"</strong> event'
      || coalesce(' and a detention on ' || to_char(v_detention, 'FMDay FMDD FMMonth'), '') || '.</p>'
      || '<p>If they really were away for a known reason (an appointment, illness, a trip), please change the C '
      || 'to the matching code (M, I, E or H) on Student Marks or the register: '
      || '<a href="' || v_url || '">' || v_url || '</a>. '
      || 'The −5 and the detention are withdrawn as soon as the C is changed. If not, you don''t need to do anything.</p>';
  else
    v_subject := 'Please confirm: ' || v_student || ' missed ' || coalesce(v_lesson, v_period);
    v_html := '<p>You marked <strong>' || html_escape(v_student) || '</strong>'
      || coalesce(' (Year ' || v_year || ')', '') || ' as <strong>' || html_escape(coalesce(v_code, 'absent')) || '</strong>'
      || ' at ' || html_escape(coalesce(v_period, 'period ' || v_link.period_number))
      || coalesce(' (' || html_escape(v_lesson) || ')', '')
      || ' on ' || to_char(v_link.attend_date, 'FMDay FMDD FMMonth YYYY') || '.</p>'
      || '<p>They were marked present or late at another period that day, so Formwork has recorded a '
      || '<strong>−5 "Missing a lesson activity"</strong> event'
      || coalesce(' and a detention on ' || to_char(v_detention, 'FMDay FMDD FMMonth'), '') || '.</p>'
      || '<p><strong>Was ' || html_escape(v_student) || ' really not in your '
      || case when a.other_half_activity_id is not null then 'activity' else 'lesson' end || '?</strong></p>'
      || '<p>If they were not there, you don''t need to do anything.</p>'
      || '<p>If they were there, or were away for a reason, please correct the mark on the register now: '
      || '<a href="' || v_url || '">' || v_url || '</a>. '
      || 'The −5 and the detention are withdrawn as soon as the mark is corrected.</p>';
  end if;

  if v_logins is not null then
    perform post_inbox_notice(v_logins, v_subject, v_html, 'missed_lesson');
  end if;
  if v_emails is not null then
    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(v_emails),
      'subject', v_subject,
      'html', v_html,
      'reply_to', email_reply_to('missed_lesson')));
  end if;

  update missed_lesson_negatives set notified_at = now() where id = p_link_id;
end;
$$;

revoke execute on function public.notify_missed_lesson_negative(bigint) from public, anon, authenticated;
