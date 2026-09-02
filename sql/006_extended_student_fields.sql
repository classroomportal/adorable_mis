-- Families: link siblings together
CREATE TABLE families (
    family_id   SERIAL PRIMARY KEY,
    family_name TEXT
);

ALTER TABLE families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_families" ON families FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_families" ON families FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Extended student fields
ALTER TABLE students ADD COLUMN IF NOT EXISTS middle_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS legal_first_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS legal_last_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS preferred_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_email TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS postcode TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS family_id INTEGER REFERENCES families(family_id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS nationality TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS religion TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT;
