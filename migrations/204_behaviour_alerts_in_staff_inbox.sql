-- 204_behaviour_alerts_in_staff_inbox.sql
--
-- Serious behaviour alerts (notify_pastoral_on_negative_behaviour, migration
-- 202: to cs@abc.sch.ng, cc SMT and sro@abc.sch.ng) were email only, so the
-- staff they go to had nothing in their Formwork inbox and nobody could tell
-- whether an alert had been read. Post each alert to the Formwork inbox of
-- every staff member it is emailed to, as detention notices are for students
-- (migration 203), so message_recipients.read_at records who has read it.
--
-- post_inbox_notice() is the general form: one automatic message (sent_by
-- null, target_type 'automatic', target_value naming the kind) to a set of
-- logins. post_student_notice() now uses it. Staff are matched to logins by
-- the address the alert is emailed to (staff.email -> profiles.staff_id).

create or replace function public.post_inbox_notice(p_profile_ids uuid[], p_subject text, p_html text, p_kind text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_message_id bigint;
  v_count integer;
  v_body text;
begin
  if p_profile_ids is null or cardinality(p_profile_ids) = 0 then
    return false;
  end if;

  v_body := btrim(regexp_replace(
    regexp_replace(replace(replace(p_html, '</p>', E'\n\n'), '<br/>', E'\n'), '<[^>]+>', '', 'g'),
    E'\n{3,}', E'\n\n', 'g'), E' \n');

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, v_body, null, 'automatic', p_kind)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select distinct v_message_id, unnest(p_profile_ids)
  on conflict do nothing;

  get diagnostics v_count = row_count;
  update messages set recipient_count = v_count where id = v_message_id;
  return v_count > 0;
end;
$function$;

revoke execute on function public.post_inbox_notice(uuid[], text, text, text) from public, anon, authenticated;

create or replace function public.post_student_notice(p_student_id integer, p_subject text, p_html text)
returns boolean
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select post_inbox_notice(
    (select array_agg(id) from profiles where student_id = p_student_id),
    p_subject, p_html, 'detention');
$function$;

revoke execute on function public.post_student_notice(integer, text, text) from public, anon, authenticated;

-- As migration 202, plus the inbox notice to the same people.
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

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return new;
  end if;

  perform public.queue_workspace_email(jsonb_build_object(
      'to', alert_to,
      'cc', to_jsonb(coalesce(cc_list, array[]::text[])),
      'subject', subject,
      'html', body_html || '<p><a href="https://misform.work/students/' || new.student_id || '">View student in Adorable MIS</a></p>'
    )
  );

  return new;
end;
$function$;
