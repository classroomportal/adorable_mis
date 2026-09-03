-- 030_certificates_and_alerts.sql
-- Items 6 and (foundation for) 5 on the to-do list.
-- Item 10 (detention) needs no new tables — it's computed live from behaviour_events, built in the app.

-- Tracks which milestone certificates have already been awarded, so the same one isn't
-- suggested twice. Milestones are cumulative POSITIVE points only.
CREATE TABLE certificates_awarded (
    student_id    INTEGER NOT NULL REFERENCES students(student_id),
    milestone     INTEGER NOT NULL CHECK (milestone IN (100, 500, 1000)),
    awarded_date  DATE NOT NULL DEFAULT CURRENT_DATE,
    PRIMARY KEY (student_id, milestone)
);
ALTER TABLE certificates_awarded ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_certificates" ON certificates_awarded FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "staff_write_certificates" ON certificates_awarded FOR ALL USING (is_staff_or_admin()) WITH CHECK (is_staff_or_admin());
