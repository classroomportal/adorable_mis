-- 225_email_reply_to.sql
--
-- Replies to Formwork's emails now reach a person instead of the
-- mis@abc.sch.ng inbox.
--
-- Every email goes out from mis@abc.sch.ng (send-workspace-email signs in
-- to Gmail as that account) and, until now, carried no Reply-To, so a
-- parent or student who pressed Reply wrote to a mailbox nobody reads.
-- The principal's rule (27 Sep 2026):
--   * Replies go to the member of staff who sent the email.
--   * Replies from parents go to sro@abc.sch.ng.
--
-- How:
--   * queue_workspace_email() fills in `reply_to` when the caller left it
--     out: the email address of the staff member behind auth.uid(). That
--     is the person who sent the message, logged the behaviour event, set
--     or cancelled the detention, or pressed "send welcome email". It is
--     stamped when the email is queued, because process_email_outbox()
--     runs from cron with no signed-in user. queue_workspace_email is not
--     executable by API roles, so nobody can queue an email with a
--     Reply-To of their choosing.
--   * Emails to parents set reply_to = sro@abc.sch.ng explicitly:
--     send_message() for a parent recipient, and both parent welcome
--     emails. It is decided from the recipient's login (profiles.parent_id),
--     not by matching the address against `parents.email`, because several
--     staff addresses (cs@, principal@...) are also on parent records and a
--     behaviour alert to cs@ must not have its replies sent to the SRO.
--   * No signed-in staff member (the nightly detention reminders) means no
--     Reply-To, so those replies still go to mis@abc.sch.ng as before.
--
-- The edge function send-workspace-email passes `reply_to` on as the
-- Reply-To header (supabase/functions/send-workspace-email/index.ts); it
-- must be deployed with this migration.
--
-- send_message, send_parent_welcome_email and parent_welcome_email_post are
-- copied from their live definitions with only the reply_to lines added.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.queue_workspace_email(p_body jsonb)
returns bigint
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with body as (
    select case
      when nullif(trim(p_body ->> 'reply_to'), '') is not null then p_body
      else (p_body - 'reply_to') || coalesce(
        (select jsonb_build_object('reply_to', lower(trim(st.email)))
           from profiles pr
           join staff st on st.staff_id = pr.staff_id
          where pr.id = auth.uid()
            and st.email is not null and length(trim(st.email)) > 0),
        '{}'::jsonb)
    end as b
  )
  insert into email_outbox (payload, recipient, subject)
  select
    b,
    case jsonb_typeof(b -> 'to')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(b -> 'to') x)
      else b ->> 'to'
    end
    || coalesce(' (cc: ' || case jsonb_typeof(b -> 'cc')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(b -> 'cc') x)
      else b ->> 'cc'
    end || ')', ''),
    b ->> 'subject'
  from body
  returning email_id;
$function$;

revoke execute on function public.queue_workspace_email(jsonb) from public, anon, authenticated;

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
    -- Parents' replies go to the SRO; everyone else's to the sender, which
    -- queue_workspace_email fills in when reply_to is null.
    perform public.queue_workspace_email( jsonb_build_object(
        'to', coalesce(pr.email, par.email, st.student_email),
        'subject', p_subject,
        'text', p_body || E'\n\nView in your portal: https://misform.work/inbox',
        'reply_to', case when pr.parent_id is not null then 'sro@abc.sch.ng' end
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

create or replace function public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
as $function$
declare
  body_html text;
  password_html text;
  v_parent_id integer;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent. Re-enable with: update system_settings set parent_emails_paused = false;';
  end if;

  -- Resolve through the login, not parents.email: 47 emails are shared by
  -- more than one parent row, but each login belongs to exactly one parent.
  select pr.parent_id into v_parent_id
  from auth.users u
  join profiles pr on pr.id = u.id
  where lower(u.email) = lower(p_email) and pr.role = 'parent'
  limit 1;

  if p_temp_password is not distinct from parent_first_password(v_parent_id) then
    password_html := '<strong>Password:</strong> ' || p_temp_password || '</p>' ||
      '<p>Your password is your oldest child''s date of birth, written as 8 numbers: day, month, year, ' ||
      'with no spaces or slashes. For example, a child born on 24 March 2012 would be <strong>24032012</strong>.</p>';
  else
    password_html := '<strong>Password:</strong> ' || p_temp_password || '</p>';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p><strong>Introducing Formwork, our new school information system</strong></p>' ||
    '<p>Adorable British College has introduced a new online system called <strong>Formwork</strong>. ' ||
    'It gives you a parent account where you can follow your child''s school life in one place, ' ||
    'at any time, from a phone, tablet or computer.</p>' ||

    '<p><strong>Formwork is separate from SIMS</strong></p>' ||
    '<p>You may already be familiar with SIMS, including the SIMS Parent app. Formwork is a completely ' ||
    'separate system that runs on a different server from SIMS. This means:</p>' ||
    '<ul>' ||
      '<li>Your SIMS username and password will <strong>not</strong> work on Formwork. Please use the new login details below.</li>' ||
      '<li>Formwork has its own web address, <a href="https://misform.work">misform.work</a>. It is not reached through the SIMS Parent app or the SIMS website.</li>' ||
      '<li>Changing your password in one system does not change it in the other.</li>' ||
    '</ul>' ||

    '<p><strong>What you can see in Formwork</strong></p>' ||
    '<p>For each of your children:</p>' ||
    '<ul>' ||
      '<li>their timetable</li>' ||
      '<li>their results compared with their target grades</li>' ||
      '<li>their behaviour record</li>' ||
      '<li>their attendance, including today lesson by lesson</li>' ||
      '<li>school fees and payment history</li>' ||
      '<li>their tuckshop balance and spending</li>' ||
      '<li>messages from the school in your inbox</li>' ||
    '</ul>' ||

    '<p><strong>Your login details</strong></p>' ||
    '<p><strong>Web address:</strong> <a href="https://misform.work">misform.work</a><br/>' ||
    '<strong>Login email:</strong> ' || p_email || '<br/>' ||
    password_html ||
    '<p>The first time you sign in, Formwork will ask you to choose your own new password ' ||
    '(at least 8 characters). After that, use the new password you chose. ' ||
    'Keep it private: the school will never ask you for it.</p>' ||

    '<p><strong>Need help?</strong></p>' ||
    '<p>If you cannot sign in, or something about your child looks wrong, please contact the school office ' ||
    'and we will be happy to help.</p>' ||

    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Introducing Formwork: your new parent account (separate from SIMS)',
      'html', body_html,
      'reply_to', 'sro@abc.sch.ng'
    )
  );
end;
$function$;

create or replace function public.parent_welcome_email_post(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  body_html text;
  safe_name text := replace(replace(replace(coalesce(p_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
begin
  body_html := '<p>Dear ' || safe_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html,
      'reply_to', 'sro@abc.sch.ng'
    )
  );
end;
$function$;
