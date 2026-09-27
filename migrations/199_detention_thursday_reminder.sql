-- 199_detention_thursday_reminder.sql
--
-- Students are emailed when a detention is set (notify_student_of_detention,
-- send_detention_email), which can be several days before the Friday. Send
-- them a reminder the evening before as well: every Thursday at 7:30pm Lagos
-- time, each student with a detention the next day gets one email listing
-- why.
--
-- Only 'scheduled' detentions count, so one cancelled by an upheld appeal
-- (migration 197) or already marked attended/missed isn't mentioned. A student
-- with two detentions that Friday (a serious event and the weekly total) gets
-- a single email. detentions.reminded_at records the send, so running the job
-- twice for the same Friday doesn't email anyone twice. Demo rows are skipped,
-- as are students with no email address.
--
-- pg_cron runs in GMT and Lagos is UTC+1 all year (no daylight saving), so
-- 19:30 in Lagos is 18:30 in the schedule.

alter table public.detentions add column reminded_at timestamptz;

create or replace function public.send_detention_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_date date := school_today() + 1;
  v_day text := to_char(school_today() + 1, 'FMDay FMDD FMMonth YYYY');
  v_room text;
  v_time text;
  v_sent integer := 0;
  r record;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');

  for r in
    select d.student_id, s.first_name, s.student_email,
           array_agg(d.detention_id) as detention_ids,
           string_agg(
             case when d.behaviour_event_id is null
               then 'reaching 10 or more negative behaviour points this week'
               else 'a serious behaviour event: ' || coalesce(e.category, 'negative event')
                    || ' on ' || to_char(e.event_date, 'FMDay FMDD FMMonth')
             end, '; ' order by d.detention_id) as reasons
    from detentions d
    join students s on s.student_id = d.student_id
    left join behaviour_events e on e.event_id = d.behaviour_event_id
    where d.detention_date = v_date
      and d.status = 'scheduled'
      and d.reminded_at is null
      and not d.is_demo
    group by d.student_id, s.first_name, s.student_email
  loop
    if r.student_email is null or length(trim(r.student_email)) = 0 then
      continue;
    end if;

    perform public.queue_workspace_email(jsonb_build_object(
      'to', r.student_email,
      'subject', 'Reminder - detention tomorrow: ' || v_day || ', ' || v_room || ' ' || v_time,
      'html',
        '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' ||
        '<p>This is a reminder that you have a detention tomorrow, <strong>' || v_day || '</strong>.</p>' ||
        '<p>Report to <strong>' || v_room || '</strong> ' || v_time || '.</p>' ||
        '<p>It was given for ' || r.reasons || '.</p>' ||
        '<p>Adorable British College</p>'
    ));

    update detentions set reminded_at = now() where detention_id = any (r.detention_ids);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

revoke execute on function public.send_detention_reminders() from public, anon, authenticated;

select cron.schedule('detention-thursday-reminder', '30 18 * * 4', 'select public.send_detention_reminders();');
