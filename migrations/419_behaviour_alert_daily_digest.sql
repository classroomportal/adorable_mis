-- 419: behaviour alert emails become one daily summary
--
-- Why: the principal, 9 Oct 2026: "reduce the list mails going to Principal
-- and CS to be sent once a day in a summary form - one email listing the
-- details of what you would have sent". notify_pastoral_on_negative_behaviour()
-- emailed cs@ (SMT and the SRO copied in) once per alerting event: 71 emails
-- in the fortnight to 9 Oct, most of them "Missing a lesson activity" from
-- the automatic negatives (migrations 388 and 416).
--
-- What changes:
--   * The trigger still works out whether an event alerts (a single event at
--     or below behaviour_rules.detention_single_event_points, or the week's
--     total at or below alert_weekly_total_points), and still posts the same
--     inbox notice at once, but no longer queues an email. It adds a row to
--     behaviour_alert_digest instead.
--   * send_behaviour_alert_digest() (cron "behaviour-alert-daily-digest",
--     16:30 Lagos = 15:30 UTC, every day) sends one email to the same
--     people (to cs@, cc every SMT holder and sro@), reply-to
--     email_reply_to('behaviour_alert') as before, with one row per alert:
--     student, year, category, points, date, why it alerted and the
--     description. Nothing is sent on a day with no alerts.
--   * An event voided, returned to the teacher or deleted before the summary
--     goes is left out of the table and only counted ("2 alerts since
--     withdrawn"), so a corrected N/O doesn't reach SMT at all.
--   * Alerts logged after 16:30 go in the next day's summary.
--   * The description is now html-escaped (it went into the email raw).
--
-- behaviour_alert_digest has RLS and no grants: only the trigger (security
-- definer) and the cron function touch it. Its rows are kept (sent_at
-- stamped), not deleted. send_behaviour_alert_digest() has execute revoked.

create table public.behaviour_alert_digest (
  id bigserial primary key,
  event_id integer not null,
  student_id integer not null,
  reason text not null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.behaviour_alert_digest enable row level security;
-- No grants: written by the trigger, read by the cron function only.

create index behaviour_alert_digest_unsent on public.behaviour_alert_digest (queued_at) where sent_at is null;

create or replace function public.notify_pastoral_on_negative_behaviour()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  alert_to constant text := 'cs@abc.sch.ng';
  student_name text;
  cc_list text[];
  subject text;
  body_html text;
  week_start date;
  week_end date;
  week_total integer;
  reason text;
  r behaviour_rules;
begin
  if new.is_demo then
    return new;
  end if;
  select * into r from behaviour_rules where id;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if new.points <= r.detention_single_event_points then
    reason := 'A single severe event was logged (' || new.points || ' points).';
  elsif week_total <= r.alert_weekly_total_points then
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  else
    return new;
  end if;

  select first_name || ' ' || last_name into student_name from students where student_id = new.student_id;

  select array_agg(distinct lower(e)) into cc_list
  from (
    select st.email as e
    from staff st
    join staff_roles sr on sr.staff_id = st.staff_id
    where sr.role_name = 'smt' and st.email is not null and length(trim(st.email)) > 0
    union
    select 'sro@abc.sch.ng'
  ) x
  where lower(e) <> alert_to;

  subject := 'Behaviour alert: ' || student_name || ' — ' || coalesce(new.category, 'Negative event');
  body_html := '<p><strong>' || student_name || '</strong> has triggered a behaviour alert.</p>' ||
               '<p>' || reason || '</p>' ||
               '<p><strong>Latest event — Category:</strong> ' || coalesce(new.category, '—') || '<br/>' ||
               '<strong>Points:</strong> ' || coalesce(new.points::text, '—') || '<br/>' ||
               '<strong>Date:</strong> ' || new.event_date::text || '</p>' ||
               '<p>' || coalesce(new.description, '') || '</p>';

  perform post_inbox_notice(
    (select array_agg(p.id)
       from profiles p
       join staff st on st.staff_id = p.staff_id
      where lower(st.email) = any (array_append(coalesce(cc_list, array[]::text[]), alert_to))),
    subject,
    body_html || '<p>Student record: https://misform.work/students/' || new.student_id || '</p>',
    'behaviour_alert');

  -- The email goes in the daily summary (send_behaviour_alert_digest()).
  insert into behaviour_alert_digest (event_id, student_id, reason)
  values (new.event_id, new.student_id, reason);

  return new;
end;
$function$;

create or replace function public.send_behaviour_alert_digest()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  alert_to constant text := 'cs@abc.sch.ng';
  cc_list text[];
  v_key text;
  v_ids bigint[];
  v_live integer;
  v_gone integer;
  v_rows text;
  v_html text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select array_agg(id order by id) into v_ids
  from behaviour_alert_digest where sent_at is null;
  if v_ids is null then
    return 0;
  end if;

  select count(*) filter (where e.event_id is not null and e.voided_at is null and e.returned_at is null),
         count(*) filter (where e.event_id is null or e.voided_at is not null or e.returned_at is not null)
    into v_live, v_gone
  from behaviour_alert_digest d
  left join behaviour_events e on e.event_id = d.event_id
  where d.id = any (v_ids);

  if v_live > 0 then
    select string_agg(
             '<tr>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd"><a href="https://misform.work/students/' || s.student_id || '">' ||
               html_escape(s.first_name || ' ' || s.last_name) || '</a></td>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd">' || coalesce(s.year_group::text, '') || '</td>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd">' || html_escape(coalesce(e.category, 'Negative event')) || '</td>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right">' || coalesce(e.points::text, '—') || '</td>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd;white-space:nowrap">' || to_char(e.event_date, 'Dy DD Mon') || '</td>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd">' || html_escape(d.reason) || '</td>' ||
             '<td style="padding:4px 8px;border-bottom:1px solid #ddd">' || html_escape(coalesce(e.description, '')) || '</td>' ||
             '</tr>',
             '' order by s.last_name, s.first_name, e.event_date, d.id)
      into v_rows
    from behaviour_alert_digest d
    join behaviour_events e on e.event_id = d.event_id
    join students s on s.student_id = d.student_id
    where d.id = any (v_ids) and e.voided_at is null and e.returned_at is null;
  end if;

  update behaviour_alert_digest set sent_at = now() where id = any (v_ids);

  if v_live = 0 then
    return 0;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return 0;
  end if;

  select array_agg(distinct lower(e)) into cc_list
  from (
    select st.email as e
    from staff st
    join staff_roles sr on sr.staff_id = st.staff_id
    where sr.role_name = 'smt' and st.email is not null and length(trim(st.email)) > 0
    union
    select 'sro@abc.sch.ng'
  ) x
  where lower(e) <> alert_to;

  v_html := '<p>Behaviour alerts since the last summary: <strong>' || v_live || '</strong>' ||
            case when v_gone > 0 then ' (and ' || v_gone || ' since withdrawn, not listed)' else '' end ||
            '. Each was also posted to your Formwork inbox when it happened.</p>' ||
            '<table style="border-collapse:collapse;font-size:13px">' ||
            '<tr style="text-align:left;background:#f3f3f3">' ||
            '<th style="padding:4px 8px">Student</th><th style="padding:4px 8px">Year</th>' ||
            '<th style="padding:4px 8px">Category</th><th style="padding:4px 8px">Points</th>' ||
            '<th style="padding:4px 8px">Date</th><th style="padding:4px 8px">Why it alerted</th>' ||
            '<th style="padding:4px 8px">Description</th></tr>' ||
            v_rows || '</table>';

  perform public.queue_workspace_email(jsonb_build_object(
      'to', alert_to,
      'cc', to_jsonb(coalesce(cc_list, array[]::text[])),
      'subject', 'Behaviour alerts: daily summary, ' || to_char(v_today, 'FMDD Mon YYYY') ||
                 ' (' || v_live || case when v_live = 1 then ' alert)' else ' alerts)' end,
      'html', v_html,
      'reply_to', email_reply_to('behaviour_alert')
    ));

  return v_live;
end;
$function$;

revoke execute on function public.send_behaviour_alert_digest() from public, anon, authenticated;

update public.email_reply_routes
   set description = 'The daily summary of behaviour alerts (a -5 event or a week at -8) to cs@abc.sch.ng, SMT and the SRO copied in, at 4.30 pm.',
       sender_label = 'Formwork (daily summary)'
 where email_kind = 'behaviour_alert';

select cron.schedule('behaviour-alert-daily-digest', '30 15 * * *', 'select public.send_behaviour_alert_digest()');
