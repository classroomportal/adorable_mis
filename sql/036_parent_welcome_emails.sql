-- 036_parent_welcome_emails.sql
-- A callable function (admin only) that sends one welcome email via Resend, reusing the same
-- vault-stored API key set up for behaviour alerts. Called once per parent from the app.

CREATE OR REPLACE FUNCTION send_parent_welcome_email(p_email TEXT, p_name TEXT, p_temp_password TEXT)
RETURNS void AS $$
DECLARE
  api_key TEXT;
  body_html TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admin can send welcome emails';
  END IF;

  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';
  IF api_key IS NULL THEN
    RETURN;
  END IF;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://mis.classroomportal.org">mis.classroomportal.org</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Adorable British College <mis@alerts.classroomportal.org>',
      'to', jsonb_build_array(p_email),
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
