-- Migration 114: system-wide, reversible pause on emails to parents.
--
-- Every real email the system sends goes through one edge function
-- (send-workspace-email) called from a handful of Postgres functions. Only
-- two of those ever email a parent specifically: send_message() (only for
-- p_target_type = 'individual' — broadcast targets like all_parents/
-- year_group are in-app inbox only already, no separate email path exists)
-- and send_parent_welcome_email(). Neither had any gate on it.
--
-- This is a settings toggle, not a code deletion, and it's scoped to
-- parents only — it doesn't touch staff/student welcome emails or the
-- behaviour-alert trigger to SMT/houseparents, none of which were asked
-- for. Follows the same guard-function shape as is_demo_account()
-- (migration 074/081): a security definer stable function checked first,
-- so the caller fails/no-ops rather than silently half-completing.
--
-- To re-enable: update system_settings set parent_emails_paused = false;

create table if not exists system_settings (
  id boolean primary key default true,
  parent_emails_paused boolean not null default false,
  parent_emails_paused_note text,
  updated_at timestamptz not null default now(),
  constraint system_settings_singleton check (id)
);

insert into system_settings (id, parent_emails_paused, parent_emails_paused_note)
values (true, true, 'Paused system-wide, 22 Sep 2026, per school request — no emails to parents until re-enabled.')
on conflict (id) do update set
  parent_emails_paused = true,
  parent_emails_paused_note = excluded.parent_emails_paused_note,
  updated_at = now();

alter table system_settings enable row level security;

create policy "system_settings readable by all authenticated" on system_settings
  for select using (auth.role() = 'authenticated');
create policy "system_settings editable by admin" on system_settings
  for all using (is_admin()) with check (is_admin());

create or replace function parent_emails_paused()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select parent_emails_paused from system_settings limit 1), false);
$$;

-- send_parent_welcome_email: always parent-directed, so block outright.
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

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent. Re-enable with: update system_settings set parent_emails_paused = false;';
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

-- send_message: only skip the email leg for recipients who are parents
-- (pr.parent_id is not null) — staff/student individual messages, and the
-- in-app inbox copy for everyone, are unaffected. Otherwise identical to
-- migration 098's version.
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
      and coalesce(pr.email, par.email, st.student_email) is not null
      and not (pr.parent_id is not null and parent_emails_paused());
  end if;

  return v_message_id;
end;
$function$;
