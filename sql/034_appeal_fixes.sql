-- 034_appeal_fixes.sql
-- Fix 1: deleting a behaviour event should take any appeal against it with it.
-- Fix 2: upholding an appeal should actually void the event's points, not just log a status.

ALTER TABLE behaviour_appeals DROP CONSTRAINT behaviour_appeals_event_id_fkey;
ALTER TABLE behaviour_appeals ADD CONSTRAINT behaviour_appeals_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES behaviour_events(event_id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION void_event_on_upheld_appeal()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'upheld' AND (OLD.status IS DISTINCT FROM 'upheld') THEN
    UPDATE behaviour_events
    SET points = 0,
        description = COALESCE(description, '') || ' (voided — appeal upheld)'
    WHERE event_id = NEW.event_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_void_event_on_upheld_appeal ON behaviour_appeals;
CREATE TRIGGER trg_void_event_on_upheld_appeal
AFTER UPDATE ON behaviour_appeals
FOR EACH ROW
EXECUTE FUNCTION void_event_on_upheld_appeal();
