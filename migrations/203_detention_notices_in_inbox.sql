-- 203_detention_notices_in_inbox.sql
--
-- Detention notices went to students by email only (set: migration 177's
-- send_detention_email; Thursday reminder: 199; cancelled: 200). Email can't
-- say whether a student read it - mail apps pre-fetch or block the images a
-- read tracker relies on - so the principal asked for the notices to go to
-- the student's Formwork inbox as well, where message_recipients.read_at
-- records a real read and Sent Messages can show it.
--
-- post_student_notice() puts one message in every Formwork login the
-- student has (target_type 'automatic', sent_by null, as nobody wrote it by
-- hand), with the email's text as a plain-text body - the inbox shows plain
-- text. The three detention functions call it next to the email, and it
-- does not depend on the email: a student with a login but no email address
-- still gets the notice, and one with an address but no login still gets
-- the email.
--
-- "Told about the detention" now means either channel reached them:
-- student_notified_at is set when the email is queued or the inbox notice is
-- posted. That value decides both the one-notice-per-Friday rule when a
-- detention is set and whether a cancellation is worth telling them about,
-- so both keep working for students reached only one way.
--
-- SMT, Pastoral and School Office can read automatic messages (not other
-- staff's own messages) so Sent Messages can list them with read receipts;
-- message_read_status already lets those roles see who read what.

create or replace function public.post_student_notice(p_student_id integer, p_subject text, p_html text)
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
  if not exists (select 1 from profiles where student_id = p_student_id) then
    return false;
  end if;

  v_body := btrim(regexp_replace(
    regexp_replace(replace(replace(p_html, '</p>', E'\n\n'), '<br/>', E'\n'), '<[^>]+>', '', 'g'),
    E'\n{3,}', E'\n\n', 'g'), E' \n');

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, v_body, null, 'automatic', 'detention')
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, id from profiles where student_id = p_student_id
  on conflict do nothing;

  get diagnostics v_count = row_count;
  update messages set recipient_count = v_count, email_sent = false where id = v_message_id;
  return v_count > 0;
end;
$function$;

revoke execute on function public.post_student_notice(integer, text, text) from public, anon, authenticated;

-- When a detention is set. Same rules as before (one notice per student per
-- Friday, nothing for demo rows or past dates); the inbox notice is new.
create or replace function public.notify_student_of_detention()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_reason text;
  v_room text;
  v_time text;
  v_day text;
  v_emailed boolean;
  v_posted boolean;
begin
  if new.is_demo or new.status <> 'scheduled' or new.detention_date < school_today() then
    return new;
  end if;

  if exists (
    select 1 from detentions
    where student_id = new.student_id
      and detention_date = new.detention_date
      and student_notified_at is not null
  ) then
    return new;
  end if;

  if new.behaviour_event_id is not null then
    select 'a serious behaviour event: ' || coalesce(category, 'negative event') || ' (' || points || ' points) on ' || to_char(event_date, 'FMDay FMDD FMMonth')
      into v_reason
    from behaviour_events where event_id = new.behaviour_event_id;
  end if;
  v_reason := coalesce(v_reason, 'reaching 10 or more negative behaviour points this week');

  v_emailed := send_detention_email(new.student_id, new.detention_date, v_reason);

  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');
  v_day := to_char(new.detention_date, 'FMDay FMDD FMMonth YYYY');

  v_posted := post_student_notice(new.student_id,
    'Detention: ' || v_day || ', ' || v_room || ' ' || v_time,
    '<p>You have a detention on ' || v_day || '.</p>' ||
    '<p>Report to ' || v_room || ' ' || v_time || '.</p>' ||
    '<p>This detention was given for ' || v_reason || '.</p>' ||
    '<p>If you have a question about it, speak to your form tutor or houseparent before Friday.</p>');

  if v_emailed or v_posted then
    new.student_notified_at := now();
  end if;
  return new;
end;
$function$;

-- Thursday reminder: as migration 199, plus the inbox notice, and no longer
-- skipping students without an email address.
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
  v_subject text;
  v_html text;
  v_posted boolean;
  r record;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');
  v_subject := 'Reminder - detention tomorrow: ' || v_day || ', ' || v_room || ' ' || v_time;

  for r in
    select d.student_id, s.first_name, s.student_email,
           array_agg(d.detention_id) as detention_ids,
           string_agg(detention_reason(d.detention_id), '; ' order by d.detention_id) as reasons
    from detentions d
    join students s on s.student_id = d.student_id
    where d.detention_date = v_date
      and d.status = 'scheduled'
      and d.reminded_at is null
      and not d.is_demo
    group by d.student_id, s.first_name, s.student_email
  loop
    v_html := '<p>This is a reminder that you have a detention tomorrow, <strong>' || v_day || '</strong>.</p>' ||
              '<p>Report to <strong>' || v_room || '</strong> ' || v_time || '.</p>' ||
              '<p>It was given for ' || r.reasons || '.</p>';

    v_posted := post_student_notice(r.student_id, v_subject, v_html);

    if r.student_email is not null and length(trim(r.student_email)) > 0 then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', r.student_email,
        'subject', v_subject,
        'html', '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' || v_html || '<p>Adorable British College</p>'
      ));
    elsif not v_posted then
      continue;
    end if;

    update detentions set reminded_at = now() where detention_id = any (r.detention_ids);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;

-- Cancelled: as migration 200, plus the inbox notice, and no longer skipping
-- students without an email address (they were told through the inbox).
create or replace function public.notify_student_of_cancelled_detention()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  r record;
  v_day text;
  v_remaining text;
  v_room text;
  v_time text;
  v_html text;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');

  for r in
    select n.student_id, n.detention_date, s.first_name, s.student_email,
           string_agg(detention_reason(n.detention_id), '; ' order by n.detention_id) as reasons
    from new_rows n
    join old_rows o on o.detention_id = n.detention_id
    join students s on s.student_id = n.student_id
    where o.status = 'scheduled' and n.status = 'cancelled'
      and not n.is_demo
      and n.detention_date >= school_today()
    group by n.student_id, n.detention_date, s.first_name, s.student_email
  loop
    if not exists (
      select 1 from detentions
      where student_id = r.student_id and detention_date = r.detention_date
        and student_notified_at is not null
    ) then
      continue;
    end if;

    v_day := to_char(r.detention_date, 'FMDay FMDD FMMonth YYYY');

    select string_agg(detention_reason(detention_id), '; ' order by detention_id) into v_remaining
    from detentions
    where student_id = r.student_id and detention_date = r.detention_date and status = 'scheduled';

    v_html := '<p>Your detention on <strong>' || v_day || '</strong> has been <strong>cancelled</strong>. ' ||
              'It had been given for ' || r.reasons || '.</p>';
    if v_remaining is null then
      v_html := v_html || '<p>You do not need to attend detention that day.</p>';
    else
      v_html := v_html || '<p>You still have a detention that day, given for ' || v_remaining ||
                '. Report to <strong>' || v_room || '</strong> ' || v_time || ' as before.</p>';
    end if;

    perform post_student_notice(r.student_id, 'Detention cancelled: ' || v_day, v_html);

    if r.student_email is not null and length(trim(r.student_email)) > 0 then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', r.student_email,
        'subject', 'Detention cancelled: ' || v_day,
        'html', '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' || v_html || '<p>Adorable British College</p>'
      ));
    end if;
  end loop;

  return null;
end;
$function$;

create policy messages_automatic_staff_read on public.messages
  for select to authenticated
  using (sent_by is null and user_has_staff_role(array['smt', 'pastoral', 'school_office']));
