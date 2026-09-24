-- 159: turn the parent welcome email into a proper introduction letter.
--
-- The welcome email is the first thing most parents will receive from the
-- new system, and until now it was four lines: "there's a portal, here's
-- your password". Parents already know SIMS (and the SIMS Parent app), so
-- without an explanation the likely outcomes are (a) trying their SIMS
-- login on misform.work and assuming it's broken, or (b) treating an
-- unfamiliar email with a password in it as phishing.
--
-- The letter now says plainly that Formwork is a separate system on a
-- different server from SIMS, that SIMS details won't work there (and a
-- password change in one doesn't carry to the other), what parents can
-- actually see (the sections of /parent-portal as built today), and how to
-- get help. It also renames "Adorable MIS" to Formwork, which is what the
-- product is called everywhere else, including the mail-merge template on
-- /parents/welcome-emails.
--
-- Only the letter body and subject change. The is_admin() guard and the
-- parent_emails_paused() gate from migration 114 are kept exactly as they
-- were — parent emails were paused system-wide on 22 Sep 2026 and remain
-- so; this migration does not re-enable them.

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
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>When you first sign in, please change your password straight away using "Change Password" in the menu. ' ||
    'Keep your password private: the school will never ask you for it.</p>' ||

    '<p><strong>Need help?</strong></p>' ||
    '<p>If you cannot sign in, or something about your child looks wrong, please contact the school office ' ||
    'and we will be happy to help.</p>' ||

    '<p>Kind regards,<br/>Adorable British College</p>';

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', p_email,
      'subject', 'Introducing Formwork: your new parent account (separate from SIMS)',
      'html', body_html
    )
  );
end;
$function$;
