-- 067: Boarding house + sports house lookup tables (editable lists),
-- and an auto-generated internal UPN for new students.

-- Boarding houses: seeded with the 5 known houses, admin can add more later.
CREATE TABLE IF NOT EXISTS boarding_houses (
  house_id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
INSERT INTO boarding_houses (name) VALUES
  ('Queen Victoria'), ('Rosa Parks'), ('Birmingham'), ('Buckingham'), ('Florence Nightingale')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE boarding_houses ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all_boarding_houses ON boarding_houses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY admin_write_boarding_houses ON boarding_houses FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Sports houses: seeded from whatever values already exist on students
-- (so nothing already in use gets lost); admin can rename/add via the UI.
CREATE TABLE IF NOT EXISTS sports_houses (
  house_id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
INSERT INTO sports_houses (name)
SELECT DISTINCT sports_house FROM students WHERE sports_house IS NOT NULL AND sports_house <> ''
ON CONFLICT (name) DO NOTHING;

ALTER TABLE sports_houses ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all_sports_houses ON sports_houses FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY admin_write_sports_houses ON sports_houses FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Auto-generated UPN for new students, matching the real UPN format already
-- in use (e.g. M703939825141): 1 letter + school code 7039398 + 5 digits
-- (2-digit year + 3-digit sequence). These children don't have a real UK-issued
-- UPN since they didn't start school there, so we mint one in the same shape
-- when they join us.
CREATE SEQUENCE IF NOT EXISTS student_upn_seq START 1;

CREATE OR REPLACE FUNCTION generate_next_upn() RETURNS TEXT AS $$
DECLARE
  candidate TEXT;
BEGIN
  LOOP
    candidate := 'Z7039398' || to_char(current_date, 'YY') || lpad((nextval('student_upn_seq') % 1000)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM students WHERE upn = candidate);
  END LOOP;
  RETURN candidate;
END;
$$ LANGUAGE plpgsql;
