-- Academic terms/years, so results/attendance/behaviour can be filtered by term
CREATE TABLE terms (
    term_id    SERIAL PRIMARY KEY,
    term_name  TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL
);

-- Attendance: per student, per date, optionally per period (NULL period_number = whole-day mark)
CREATE TABLE attendance (
    attendance_id SERIAL PRIMARY KEY,
    student_id    INTEGER NOT NULL REFERENCES students(student_id),
    attend_date   DATE NOT NULL,
    period_number INTEGER REFERENCES periods(period_number),
    status        TEXT NOT NULL CHECK (status IN ('present','absent','late','authorized_absence')),
    staff_id      INTEGER REFERENCES staff(staff_id),
    notes         TEXT,
    UNIQUE (student_id, attend_date, period_number)
);

CREATE INDEX idx_attendance_student_date ON attendance(student_id, attend_date);
CREATE INDEX idx_attendance_date ON attendance(attend_date);

ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all_terms" ON terms FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_terms" ON terms FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

CREATE POLICY "read_all_attendance" ON attendance FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "staff_write_attendance" ON attendance FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "staff_update_attendance" ON attendance FOR UPDATE USING (auth.role() = 'authenticated');

-- Sample term
INSERT INTO terms (term_name, start_date, end_date) VALUES
('Autumn Term 2026', '2026-09-01', '2026-12-18');

-- Sample attendance data (whole-day marks, one week)
INSERT INTO attendance (student_id, attend_date, status, staff_id)
SELECT s.student_id, d.dt, CASE
    WHEN s.last_name = 'Chen' AND d.dt = '2026-08-27' THEN 'late'
    WHEN s.last_name = 'Garcia' AND d.dt = '2026-08-26' THEN 'authorized_absence'
    ELSE 'present'
END, (SELECT staff_id FROM staff LIMIT 1)
FROM students s
CROSS JOIN (SELECT unnest(ARRAY['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28']::date[]) AS dt) d;
