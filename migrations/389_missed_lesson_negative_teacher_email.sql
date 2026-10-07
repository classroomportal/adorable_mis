-- Migration 389: the teacher who marked the absence is asked to confirm it.
--
-- Why (the principal, 7 Oct 2026, the evening 388 was first run): "the
-- teachers should get an email - to say are they confirming that x was not in
-- their lesson/activity". The automatic −5 (388) rests entirely on one mark;
-- a wrong N or O now costs a student a detention, so whoever made the mark
-- is told straight away and asked to check it.
--
-- For every automatic "Missing a lesson activity" event, the member of staff
-- who saved the absent mark (attendance.staff_id) gets one email and the same
-- notice in their Formwork inbox (kind missed_lesson): the student, year,
-- lesson or activity, period, date and code, that a −5 and a detention on
-- <Friday> have been recorded, and the question "Was <name> really not in
-- your lesson?". If they weren't, nothing to do. If they were (or were away
-- for a reason), correct the mark on the register, linked straight to that
-- register; 388's trigger then withdraws the event and cancels the detention.
-- Confirming is by not correcting: there is no button, deliberately, so a
-- teacher who ignores the email leaves the record as they marked it.
--
-- missed_lesson_negatives.notified_at records that the teacher was told (null
-- when the mark has no staff member with an email or login). The email goes
-- through queue_workspace_email() with a new reply route, 'missed_lesson',
-- seeded to the attendance officer (guardian.counselling@), editable at
-- /admin/email-replies. Names go into the HTML through html_escape().
--
-- notify_missed_lesson_negative() is called by record_missed_lesson_negatives()
-- for each event it makes; no grants. The 11 events recorded by hand on
-- 7 Oct (run early, at the principal's request) are notified at the end of
-- this migration.

set local formwork.change_note = 'Principal (direct)';

alter table public.missed_lesson_negatives add column notified_at timestamptz;

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('missed_lesson', 'Missed lesson: please confirm',
   'The email to the teacher who marked a student absent, when Formwork records an automatic missed-lesson negative and detention.',
   null, 60, false, false, array['guardian.counselling@abc.sch.ng'])
on conflict (email_kind) do nothing;

create or replace function public.notify_missed_lesson_negative(p_link_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
  v_email text;
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
  if a.attendance_id is null or a.staff_id is null then
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

  select lower(btrim(email)) into v_email from staff where staff_id = a.staff_id;
  if not is_plain_email(v_email) then
    v_email := null;
  end if;
  select array_agg(id) into v_logins from profiles where staff_id = a.staff_id;

  if v_email is null and v_logins is null then
    return;
  end if;

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

  if v_logins is not null then
    perform post_inbox_notice(v_logins, v_subject, v_html, 'missed_lesson');
  end if;
  if v_email is not null then
    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(array[v_email]),
      'subject', v_subject,
      'html', v_html,
      'reply_to', email_reply_to('missed_lesson')));
  end if;

  update missed_lesson_negatives set notified_at = now() where id = p_link_id;
end;
$$;

revoke execute on function public.notify_missed_lesson_negative(bigint) from public, anon, authenticated;

-- record_missed_lesson_negatives() as in 388, plus the notice for each new event.
create or replace function public.record_missed_lesson_negatives()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
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
    select a.attendance_id, a.student_id, a.period_number, sd.period_name, sd.start_time,
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
       and a.status = 'absent'
       and not a.is_demo
       and coalesce(sd.short_label, '') <> 'M'
       and v_now >= v_today + sd.end_time
       and exists (
         select 1 from attendance e
          where e.student_id = a.student_id and e.attend_date = v_today
            and e.status in ('present', 'late')
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
         || ', having been marked present or late at another period that day.',
       m.class_id)
    returning event_id into v_event_id;

    insert into missed_lesson_negatives (student_id, attend_date, period_number, attendance_id, event_id)
    values (m.student_id, v_today, m.period_number, m.attendance_id, v_event_id)
    on conflict (student_id, attend_date, period_number) do nothing
    returning id into v_link_id;

    -- Migration 389: ask the teacher who marked it to confirm. An email
    -- problem never stops the event being recorded.
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

-- The 11 events recorded on 7 Oct before this migration.
select public.notify_missed_lesson_negative(id)
  from public.missed_lesson_negatives
 where notified_at is null and withdrawn_at is null;
