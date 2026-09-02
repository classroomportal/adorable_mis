-- 026_attendance_codes.sql
-- Proper attendance register codes (matches standard UK-style SIMS codes), mapped to the
-- existing broad status categories so all existing summaries/reports keep working unchanged.

CREATE TABLE attendance_codes (
    code        TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('present','absent','late','authorized_absence'))
);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS code TEXT REFERENCES attendance_codes(code);

ALTER TABLE attendance_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_attendance_codes" ON attendance_codes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_attendance_codes" ON attendance_codes FOR ALL USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO attendance_codes (code, description, status) VALUES
  ('/', 'Present', 'present'),
  ('L', 'Late', 'late'),
  ('N', 'No reason given (unauthorised)', 'absent'),
  ('O', 'Unauthorised absence', 'absent'),
  ('I', 'Illness', 'authorized_absence'),
  ('M', 'Medical/dental appointment', 'authorized_absence'),
  ('C', 'Other authorised absence', 'authorized_absence'),
  ('E', 'Educational visit/excursion', 'authorized_absence'),
  ('H', 'Authorised holiday', 'authorized_absence');

-- Backfill a sensible code for any existing attendance rows that predate this table
UPDATE attendance SET code = CASE status
  WHEN 'present' THEN '/'
  WHEN 'late' THEN 'L'
  WHEN 'absent' THEN 'N'
  WHEN 'authorized_absence' THEN 'C'
END
WHERE code IS NULL;
