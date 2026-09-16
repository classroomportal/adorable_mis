-- Migration 081: block the demo account from sending real communications
-- send_message() has no permission check at all — any authenticated user can call
-- it directly (not just via the Compose UI), it resolves real recipients from real
-- students/parents/staff, and genuinely emails them via Resend when the recipient
-- count is <=30. Hiding the Communication tile from staff_demo's dashboard would
-- only stop accidental clicks, not a direct RPC call or someone navigating straight
-- to /comms/compose. This closes it at the source: the function itself now refuses
-- to run for the demo account, full stop, regardless of how it's invoked.

create or replace function send_message(
  p_subject text, p_body text, p_target_type text, p_target_value text
) returns bigint
language plpgsql security definer as $$
declare
  v_message_id bigint;
  v_count int;
  v_api_key text;
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

  update messages set recipient_count = v_count, email_sent = (v_count <= 30) where id = v_message_id;

  if v_count <= 30 then
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
