-- Migration 083: fix a regression introduced by migration 081
-- 081 added the is_demo_account() guard to send_message(), but it was built off
-- sql/069's version of the function without noticing sql/070 later superseded it
-- with different email logic (individual sends always email; group/broadcast
-- sends never email — no more 30-recipient threshold). Running 081 silently
-- reverted the live function back to 069's threshold-based logic. This restores
-- 070's actual behaviour while keeping the demo-account guard.

create or replace function send_message(
  p_subject text, p_body text, p_target_type text, p_target_value text
) returns bigint
language plpgsql security definer as $$
declare
  v_message_id bigint;
  v_count int;
  v_api_key text;
  v_should_email boolean;
begin
  if is_demo_account() then
    raise exception 'Communication is disabled for the training account — no message was sent.';
  end if;

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, profile_id from resolve_message_recipients(p_target_type, p_target_value)
  on conflict do nothing;

  select count(*) into v_count from message_recipients where message_id = v_message_id;

  -- individual sends always email; every group/broadcast type is in-app only
  v_should_email := (p_target_type = 'individual');

  update messages set recipient_count = v_count, email_sent = v_should_email where id = v_message_id;

  if v_should_email then
    select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key';

    if v_api_key is not null then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Adorable MIS <no-reply@mis.classroomportal.org>',
          'to', coalesce(pr.email, par.email, st.student_email),
          'subject', p_subject,
          'text', p_body || E'\n\nView in your portal: https://mis.classroomportal.org/inbox'
        )
      )
      from profiles pr
      join message_recipients mr on mr.profile_id = pr.id
      left join parents par on par.parent_id = pr.parent_id
      left join students st on st.student_id = pr.student_id
      where mr.message_id = v_message_id
        and coalesce(pr.email, par.email, st.student_email) is not null;
    end if;
  end if;

  return v_message_id;
end;
$$;
