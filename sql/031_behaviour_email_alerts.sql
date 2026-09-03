-- 031_behaviour_email_alerts.sql
-- Item 5 on the to-do list: email SMT/Houseparents automatically on every negative behaviour event.
-- Runs entirely inside Postgres via pg_net (no separate server/edge function needed).
--
-- IMPORTANT: replace YOUR_RESEND_API_KEY_HERE below with your real Resend API key before running.
-- Do not commit the real key to GitHub — this file is intentionally checked in with a placeholder.

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Store the key securely in Supabase Vault (encrypted at rest, not visible in plain SQL after this runs)
SELECT vault.create_secret('YOUR_RESEND_API_KEY_HERE', 'resend_api_key', 'Resend API key for behaviour alert emails');

CREATE OR REPLACE FUNCTION notify_pastoral_on_negative_behaviour()
RETURNS TRIGGER AS $$
DECLARE
  api_key TEXT;
  student_name TEXT;
  recipients TEXT[];
  subject TEXT;
  body_html TEXT;
BEGIN
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';
  IF api_key IS NULL THEN
    RETURN NEW; -- key not set up yet, skip silently rather than erroring on every behaviour entry
  END IF;

  SELECT first_name || ' ' || last_name INTO student_name FROM students WHERE student_id = NEW.student_id;

  SELECT array_agg(DISTINCT st.email) INTO recipients
  FROM staff st
  JOIN staff_roles sr ON sr.staff_id = st.staff_id
  WHERE sr.role_name IN ('smt','houseparent') AND st.email IS NOT NULL;

  IF recipients IS NULL OR array_length(recipients, 1) = 0 THEN
    RETURN NEW; -- nobody with an email on file to notify yet
  END IF;

  subject := 'Behaviour alert: ' || student_name || ' — ' || COALESCE(NEW.category, 'Negative event');
  body_html := '<p><strong>' || student_name || '</strong> received a negative behaviour event.</p>' ||
               '<p><strong>Category:</strong> ' || COALESCE(NEW.category, '—') || '<br/>' ||
               '<strong>Points:</strong> ' || COALESCE(NEW.points::text, '—') || '<br/>' ||
               '<strong>Date:</strong> ' || NEW.event_date::text || '</p>' ||
               '<p>' || COALESCE(NEW.description, '') || '</p>' ||
               '<p><a href="https://mis.classroomportal.org/students/' || NEW.student_id || '">View student in Adorable MIS</a></p>';

  PERFORM net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', 'Adorable MIS Alerts <alerts@alerts.classroomportal.org>',
      'to', to_jsonb(recipients),
      'subject', subject,
      'html', body_html
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_pastoral_on_negative_behaviour ON behaviour_events;
CREATE TRIGGER trg_notify_pastoral_on_negative_behaviour
AFTER INSERT ON behaviour_events
FOR EACH ROW
WHEN (NEW.type = 'negative')
EXECUTE FUNCTION notify_pastoral_on_negative_behaviour();
