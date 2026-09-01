-- Profiles: links Supabase auth users to a role
CREATE TABLE profiles (
    id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email      TEXT,
    role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
    staff_id   INTEGER REFERENCES staff(staff_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles" ON profiles
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    );

-- Periods reference table: the fixed 9-slot daily structure
CREATE TABLE periods (
    period_number INTEGER PRIMARY KEY,
    period_name   TEXT NOT NULL
);

INSERT INTO periods (period_number, period_name) VALUES
(1, 'Registration'),
(2, 'Period 1'),
(3, 'Period 2'),
(4, 'Period 3'),
(5, 'Period 4'),
(6, 'Period 5'),
(7, 'Period 6'),
(8, 'The Other Half'),
(9, 'Evening Prep');

-- Replace the old "authenticated = full access" policies with role-aware ones.
-- Staff: read everything, write results/behaviour only.
-- Admin: full read/write on everything.

DROP POLICY IF EXISTS "Authenticated staff full access" ON students;
DROP POLICY IF EXISTS "Authenticated staff full access" ON parents;
DROP POLICY IF EXISTS "Authenticated staff full access" ON student_parent;
DROP POLICY IF EXISTS "Authenticated staff full access" ON subjects;
DROP POLICY IF EXISTS "Authenticated staff full access" ON staff;
DROP POLICY IF EXISTS "Authenticated staff full access" ON classes;
DROP POLICY IF EXISTS "Authenticated staff full access" ON timetable_slots;
DROP POLICY IF EXISTS "Authenticated staff full access" ON student_class;
DROP POLICY IF EXISTS "Authenticated staff full access" ON behaviour_events;
DROP POLICY IF EXISTS "Authenticated staff full access" ON results;

-- Read access: any authenticated user (staff or admin)
CREATE POLICY "read_all_students" ON students FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_parents" ON parents FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_student_parent" ON student_parent FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_subjects" ON subjects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_staff" ON staff FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_classes" ON classes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_timetable_slots" ON timetable_slots FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_student_class" ON student_class FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_behaviour" ON behaviour_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "read_all_results" ON results FOR SELECT USING (auth.role() = 'authenticated');

-- Write access: staff can insert/update behaviour + results (their day-to-day job)
CREATE POLICY "staff_write_behaviour" ON behaviour_events FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "staff_update_behaviour" ON behaviour_events FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "staff_write_results" ON results FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "staff_update_results" ON results FOR UPDATE USING (auth.role() = 'authenticated');

-- Admin-only write access on core/structural data
CREATE POLICY "admin_write_students" ON students FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_parents" ON parents FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_student_parent" ON student_parent FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_subjects" ON subjects FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_staff" ON staff FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_classes" ON classes FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_timetable_slots" ON timetable_slots FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
CREATE POLICY "admin_write_student_class" ON student_class FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);
