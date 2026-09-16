-- Migration 082: stop demo behaviour events from emailing real staff
-- notify_pastoral_on_negative_behaviour() (sql/031_behaviour_email_alerts.sql) fires
-- on every negative behaviour_events insert with no is_demo check, and genuinely
-- emails every real SMT/houseparent's real inbox via Resend. The staff_demo seed
-- data (migration 079) includes negative events that cross its alert thresholds,
-- so running reset_demo_data() sends real alert emails about fake students. This
-- adds the missing guard: skip the alert entirely for demo rows.

CREATE OR REPLACE FUNCTION notify_pastoral_on_negative_behaviour()
RETURNS TRIGGER AS $$
DECLARE
  api_key TEXT;
  student_name TEXT;
  recipients TEXT[];
  subject TEXT;
  body_html TEXT;
  week_start DATE;
  week_end DATE;
  week_total INTEGER;
  reason TEXT;
BEGIN
  IF NEW.is_demo THEN
    RETURN NEW; -- training account data must never trigger real staff alerts
  END IF;

  -- Only escalate for a single severe event (-4 or worse) or a bad Sat-Fri week (-8 or worse total)
  week_start := NEW.event_date - (((EXTRACT(DOW FROM NEW.event_date)::INT - 6 + 7) % 7));
  week_end := week_start + 6;

  SELECT COALESCE(SUM(points), 0) INTO week_total
  FROM behaviour_events
  WHERE student_id = NEW.student_id AND type = 'negative'
    AND event_date BETWEEN week_start AND week_end;
  -- week_total already includes NEW since this trigger runs AFTER INSERT

  IF NEW.points <= -4 THEN
    reason := 'A single severe event was logged (' || NEW.points || ' points).';
  ELSIF week_total <= -8 THEN
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  ELSE
    RETURN NEW; -- doesn't meet either threshold, no alert
  END IF;

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
  body_html := '<p><strong>' || student_name || '</strong> has triggered a behaviour alert.</p>' ||
               '<p>' || reason || '</p>' ||
               '<p><strong>Latest event — Category:</strong> ' || COALESCE(NEW.category, '—') || '<br/>' ||
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
