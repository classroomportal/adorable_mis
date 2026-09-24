-- 168_behaviour_alert_email_minus_5.sql
-- The SMT/houseparent behaviour alert email should only fire for a single
-- event when it is serious, and migration 166 settled that serious means -5.
-- notify_pastoral_on_negative_behaviour() still fired at -4, so a -4 event
-- emailed SMT and houseparents while being treated as not serious everywhere
-- else. This moves the single-event trigger to -5.
--
-- Deliberately unchanged: the weekly-total alert (a Sat-Fri running total of
-- -8 or worse), recipients, wording and the demo-account skip.
--
-- Also stops writing the send-workspace-email key into the function body.
-- Like send_detention_email() (migration 167) it is now read from Supabase
-- Vault ('send_workspace_email_key'); if that secret is missing, no alert is
-- sent rather than the insert failing.

create or replace function notify_pastoral_on_negative_behaviour()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  student_name text;
  recipients text[];
  subject text;
  body_html text;
  week_start date;
  week_end date;
  week_total integer;
  reason text;
  v_key text;
begin
  if new.is_demo then
    return new;
  end if;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if new.points <= -5 then
    reason := 'A single severe event was logged (' || new.points || ' points).';
  elsif week_total <= -8 then
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  else
    return new;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return new;
  end if;

  select first_name || ' ' || last_name into student_name from students where student_id = new.student_id;

  select array_agg(distinct st.email) into recipients
  from staff st
  join staff_roles sr on sr.staff_id = st.staff_id
  where sr.role_name in ('smt','houseparent') and st.email is not null;

  if recipients is null or array_length(recipients, 1) = 0 then
    return new;
  end if;

  subject := 'Behaviour alert: ' || student_name || ' — ' || coalesce(new.category, 'Negative event');
  body_html := '<p><strong>' || student_name || '</strong> has triggered a behaviour alert.</p>' ||
               '<p>' || reason || '</p>' ||
               '<p><strong>Latest event — Category:</strong> ' || coalesce(new.category, '—') || '<br/>' ||
               '<strong>Points:</strong> ' || coalesce(new.points::text, '—') || '<br/>' ||
               '<strong>Date:</strong> ' || new.event_date::text || '</p>' ||
               '<p>' || coalesce(new.description, '') || '</p>' ||
               '<p><a href="https://misform.work/students/' || new.student_id || '">View student in Adorable MIS</a></p>';

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', to_jsonb(recipients),
      'subject', subject,
      'html', body_html
    )
  );

  return new;
end;
$$;
