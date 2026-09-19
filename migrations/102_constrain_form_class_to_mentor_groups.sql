-- students.form_class (free text) and students.mentor_group_id (FK to
-- mentor_groups) represent the same grouping but nothing kept them in sync:
-- /students/import writes form_class only, so 3 of the 21 recently-imported
-- new joiners already had a form_class with no matching mentor_group_id.
-- mentor_groups.group_name is already unique, so this adds a real FK on
-- form_class (matching the existing boarding_house/sports_house pattern)
-- plus a trigger that derives mentor_group_id from form_class automatically,
-- so the app/importers only ever need to set form_class and the two columns
-- can no longer drift apart.
--
-- The demo training account's placeholder form_class ('8-DEMO') isn't a real
-- form group, so it gets its own mentor_groups row rather than being
-- special-cased out of the new constraint.

INSERT INTO mentor_groups (group_name, year_group, description)
VALUES ('8-DEMO', 8, 'Placeholder form group for the staff_demo training account')
ON CONFLICT (group_name) DO NOTHING;

ALTER TABLE students
  ADD CONSTRAINT students_form_class_fkey
  FOREIGN KEY (form_class) REFERENCES mentor_groups (group_name)
  ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION sync_mentor_group_from_form_class()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.form_class IS NULL THEN
    NEW.mentor_group_id := NULL;
  ELSE
    SELECT mentor_group_id INTO NEW.mentor_group_id
    FROM mentor_groups WHERE group_name = NEW.form_class;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_mentor_group_from_form_class
  BEFORE INSERT OR UPDATE OF form_class ON students
  FOR EACH ROW
  EXECUTE FUNCTION sync_mentor_group_from_form_class();

-- Backfill: force the trigger to run for every existing row so
-- mentor_group_id catches up with form_class (fixes the 3 drifted new
-- joiners and anyone else out of sync).
UPDATE students SET form_class = form_class WHERE form_class IS NOT NULL;
