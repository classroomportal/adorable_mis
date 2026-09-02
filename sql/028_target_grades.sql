-- 028_target_grades.sql
-- Item 7 on the to-do list: target grades, compared against each new result and colour-coded
-- Red (below target) / Yellow (on target) / Green (above target).

-- Numeric scale so grades can be compared. Covers the A*-F range currently seen in target data,
-- plus G/U for completeness in case lower grades are entered later.
CREATE TABLE grade_scale (
    grade  TEXT PRIMARY KEY,
    points NUMERIC NOT NULL
);
INSERT INTO grade_scale (grade, points) VALUES
  ('A*', 8), ('A', 7), ('B', 6), ('C', 5), ('D', 4), ('E', 3), ('F', 2), ('G', 1), ('U', 0);
ALTER TABLE grade_scale ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_grade_scale" ON grade_scale FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_grade_scale" ON grade_scale FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- One target grade per student per subject (from CAT4-derived predictions)
CREATE TABLE target_grades (
    student_id   INTEGER NOT NULL REFERENCES students(student_id),
    subject_id   INTEGER NOT NULL REFERENCES subjects(subject_id),
    target_grade TEXT NOT NULL REFERENCES grade_scale(grade),
    PRIMARY KEY (student_id, subject_id)
);
ALTER TABLE target_grades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_target_grades" ON target_grades FOR SELECT USING (is_staff_or_admin());
CREATE POLICY "assessment_write_target_grades" ON target_grades FOR ALL USING (is_assessment_manager()) WITH CHECK (is_assessment_manager());
CREATE POLICY "parent_read_own_target_grades" ON target_grades FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p JOIN student_parent sp ON sp.parent_id = p.parent_id
    WHERE p.id = auth.uid() AND sp.student_id = target_grades.student_id
  )
);
CREATE POLICY "student_read_own_target_grades" ON target_grades FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.student_id = target_grades.student_id)
);

-- results.grade needs to be checkable against grade_scale for the colour comparison to work;
-- not a hard FK (some historical grades may be free text/percentages), just make sure the subjects
-- referenced by the target grades import all exist.
INSERT INTO subjects (subject_name)
SELECT v FROM (VALUES
  ('Add Maths'),('Art'),('Biology'),('Chemistry'),('Chinese'),('Computing'),('Economics'),
  ('English'),('English Lit'),('Extended'),('Food'),('French'),('Geography'),('Graphics'),
  ('History'),('ICT'),('Maths'),('PE'),('Physics'),('Religion'),('Sociology'),('Spanish')
) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE lower(subject_name) = lower(t.v));
