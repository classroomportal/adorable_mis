-- Migration 098: repoint every emailed link from mis.classroomportal.org to misform.work
--
-- mis.classroomportal.org is not the domain actually in use — every real
-- email this system sends (parent/staff welcome emails, behaviour alerts to
-- SMT/houseparents, and send_message() announcements) has been linking back
-- to it regardless. Found while diagnosing an unrelated "password reset link
-- didn't work" report, which turned up the same wrong-domain mistake in the
-- app's own forgot-password redirect. Repointing every live function that
-- hardcodes it — text/HTML content only, no other logic changed.

create or replace function public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text)
 returns bigint
 language plpgsql
 security definer
as $function$
declare
  v_message_id bigint;
  v_count int;
  v_should_email boolean;
begin
  if is_demo_account() then
    raise exception 'Communication is disabled for the training account — no message was sent.';
  end if;

  if not user_has_staff_role(array['smt', 'pastoral', 'school_office']) then
    raise exception 'You do not have permission to send messages.';
  end if;

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, profile_id from resolve_message_recipients(p_target_type, p_target_value)
  on conflict do nothing;

  select count(*) into v_count from message_recipients where message_id = v_message_id;

  v_should_email := (p_target_type = 'individual');

  update messages set recipient_count = v_count, email_sent = v_should_email where id = v_message_id;

  if v_should_email then
    perform net.http_post(
      url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
      headers := jsonb_build_object(
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'to', coalesce(pr.email, par.email, st.student_email),
        'subject', p_subject,
        'text', p_body || E'\n\nView in your portal: https://misform.work/inbox'
      )
    )
    from profiles pr
    join message_recipients mr on mr.profile_id = pr.id
    left join parents par on par.parent_id = pr.parent_id
    left join students st on st.student_id = pr.student_id
    where mr.message_id = v_message_id
      and coalesce(pr.email, par.email, st.student_email) is not null;
  end if;

  return v_message_id;
end;
$function$;

create or replace function public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text)
 returns void
 language plpgsql
 security definer
as $function$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html
    )
  );
end;
$function$;

create or replace function public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text)
 returns void
 language plpgsql
 security definer
as $function$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a staff account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your timetable, take attendance registers, enter results, and access student and behaviour records relevant to your role.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS staff account',
      'html', body_html
    )
  );
end;
$function$;

create or replace function public.notify_pastoral_on_negative_behaviour()
 returns trigger
 language plpgsql
 security definer
as $function$
declare
  student_name text;
  recipients text[];
  subject text;
  body_html text;
  week_start date;
  week_end date;
  week_total integer;
  reason text;
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

  if new.points <= -4 then
    reason := 'A single severe event was logged (' || new.points || ' points).';
  elsif week_total <= -8 then
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  else
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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
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
$function$;
