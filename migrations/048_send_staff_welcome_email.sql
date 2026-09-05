-- Migration 048: send_staff_welcome_email()
-- Mirrors send_parent_welcome_email() exactly in structure, with wording
-- appropriate for a staff account instead of a parent portal account.

CREATE OR REPLACE FUNCTION public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
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
    '<p>You now have a staff account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your timetable, take attendance registers, enter results, and access student and behaviour records relevant to your role.</p>' ||
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
      'subject', 'Your Adorable MIS staff account',
      'html', body_html
    )
  );
END;
$function$;
