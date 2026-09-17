-- Migration 091: send_message() had no caller authorization check at all
--
-- app/comms/compose/page.js only lets smt/pastoral/school_office/admin see the
-- link (client-side check: profile.role === 'admin' || staffRoles includes
-- one of those). But send_message() itself — a SECURITY DEFINER function —
-- never verified the caller's role; it only blocked demo accounts. Anyone
-- who called supabase.rpc('send_message', ...) directly, bypassing the UI
-- entirely, could email any target group. With Resend on a tight daily quota
-- (see docs/todo.md), that's not just a security gap, it's a way to burn the
-- whole account's email allowance in one call. Adds the same
-- user_has_staff_role() check the RLS policies elsewhere already use,
-- matching exactly what the compose page's own gating already implies but
-- never enforced server-side. send_parent_welcome_email() already had this
-- pattern (is_admin() check) — send_message() was the odd one out.

create or replace function public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text)
returns bigint
language plpgsql
security definer
as $function$
declare
  v_message_id bigint;
  v_count int;
  v_api_key text;
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
$function$;
