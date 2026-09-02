-- 027_roles_permissions.sql
-- Foundation for items 2, 3, 4, 11, 12 on the to-do list:
--   - named staff roles (Houseparent, HoD, Assessment Manager, SMT, Sysadmin, Class Teacher)
--   - teachers can no longer read parent contact details
--   - only Assessment Managers (+ admin) can write results
--   - profiles gained parent_id/student_id so parent & student portal logins can be scoped later
--   - blanket "any authenticated user reads everything" policies tightened to staff/admin only,
--     so a future parent/student login doesn't inherit access to the whole school by default

-- Staff need an email on file to be invited to log in
ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT;

-- Bring the admin-check function under version control (it existed live in Supabase already,
-- created ad hoc in an earlier session to fix RLS recursion on `profiles` — this just re-affirms it)
CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_staff_or_admin() RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','staff'));
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Portal account types: parent and student logins, alongside existing staff/admin
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin','staff','parent','student'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES parents(parent_id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(student_id);

-- Named staff roles — a staff member can hold more than one (e.g. Class Teacher + Head of Department)
CREATE TABLE staff_roles (
    staff_id  INTEGER NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
    role_name TEXT NOT NULL CHECK (role_name IN
        ('sysadmin','smt','houseparent','head_of_department','assessment_manager','class_teacher')),
    PRIMARY KEY (staff_id, role_name)
);
ALTER TABLE staff_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_staff_roles" ON staff_roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_staff_roles" ON staff_roles FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE OR REPLACE FUNCTION has_staff_role(role_names TEXT[]) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN staff_roles sr ON sr.staff_id = p.staff_id
    WHERE p.id = auth.uid() AND sr.role_name = ANY(role_names)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_pastoral_or_smt() RETURNS BOOLEAN AS $$
  SELECT is_admin() OR has_staff_role(ARRAY['smt','houseparent']);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_assessment_manager() RETURNS BOOLEAN AS $$
  SELECT is_admin() OR has_staff_role(ARRAY['assessment_manager']);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- #2: teachers can see everything EXCEPT parent contact details; only pastoral/SMT/admin get those
DROP POLICY IF EXISTS "read_all_parents" ON parents;
DROP POLICY IF EXISTS "read_all_student_parent" ON student_parent;
CREATE POLICY "read_parents_pastoral" ON parents FOR SELECT USING (is_pastoral_or_smt());
CREATE POLICY "read_student_parent_pastoral" ON student_parent FOR SELECT USING (is_pastoral_or_smt());

-- #3: only Assessment Managers (+ admin) can enter/edit results — replaces "any staff" write access
DROP POLICY IF EXISTS "staff_write_results" ON results;
DROP POLICY IF EXISTS "staff_update_results" ON results;
CREATE POLICY "assessment_write_results" ON results FOR INSERT WITH CHECK (is_assessment_manager());
CREATE POLICY "assessment_update_results" ON results FOR UPDATE USING (is_assessment_manager());

-- Tighten "any authenticated user" blanket reads to staff/admin only, so a parent/student login
-- doesn't inherit school-wide visibility the moment it's created. Scoped own-record policies for
-- parents/students are added on top afterwards.
DROP POLICY IF EXISTS "read_all_students" ON students;
DROP POLICY IF EXISTS "read_all_results" ON results;
DROP POLICY IF EXISTS "read_all_behaviour" ON behaviour_events;
DROP POLICY IF EXISTS "read_all_attendance" ON attendance;
CREATE POLICY "staff_read_students" ON students FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "staff_read_results" ON results FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "staff_read_behaviour" ON behaviour_events FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "staff_read_attendance" ON attendance FOR SELECT USING (is_staff_or_admin());

-- #4/#11 foundation: parents/students can read only their own linked records.
-- (Login pages themselves are separate follow-up work — this makes the data safe once they exist.)
CREATE POLICY "parent_read_own_contact" ON parents FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.parent_id = parents.parent_id)
);
CREATE POLICY "parent_read_own_child" ON students FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p JOIN student_parent sp ON sp.parent_id = p.parent_id
    WHERE p.id = auth.uid() AND sp.student_id = students.student_id
  )
);
CREATE POLICY "student_read_self" ON students FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.student_id = students.student_id)
);
CREATE POLICY "parent_read_own_results" ON results FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p JOIN student_parent sp ON sp.parent_id = p.parent_id
    WHERE p.id = auth.uid() AND sp.student_id = results.student_id
  )
);
CREATE POLICY "student_read_own_results" ON results FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.student_id = results.student_id)
);
CREATE POLICY "parent_read_own_behaviour" ON behaviour_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p JOIN student_parent sp ON sp.parent_id = p.parent_id
    WHERE p.id = auth.uid() AND sp.student_id = behaviour_events.student_id
  )
);
CREATE POLICY "student_read_own_behaviour" ON behaviour_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.student_id = behaviour_events.student_id)
);

-- Every existing staff member defaults to Class Teacher so nobody loses access outright;
-- the sysadmin can then add SMT/Houseparent/HoD/Assessment Manager/Sysadmin on top as needed.
INSERT INTO staff_roles (staff_id, role_name)
SELECT staff_id, 'class_teacher' FROM staff
ON CONFLICT DO NOTHING;
