-- Additional student-level flags seen in the CoreSats export
ALTER TABLE students ADD COLUMN IF NOT EXISTS ethnicity TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS fsm TEXT;   -- free school meals: Yes/No/Unspecified
ALTER TABLE students ADD COLUMN IF NOT EXISTS eal TEXT;   -- English as additional language
ALTER TABLE students ADD COLUMN IF NOT EXISTS send TEXT;  -- special educational needs
ALTER TABLE students ADD COLUMN IF NOT EXISTS custom1 TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS custom2 TEXT;

-- CAT4 (Cognitive Abilities Test) results — one row per student per sitting
CREATE TABLE cat4_results (
    cat4_id           SERIAL PRIMARY KEY,
    student_id        INTEGER NOT NULL REFERENCES students(student_id),
    test_date         DATE,
    level             TEXT,     -- e.g. "C", "E"
    mean_sas          NUMERIC,
    verbal_sas        NUMERIC,
    non_verbal_sas    NUMERIC,
    quantitative_sas  NUMERIC,
    spatial_sas       NUMERIC,
    UNIQUE (student_id, test_date)
);

-- NGRT (New Group Reading Test) results — one row per student per sitting
CREATE TABLE ngrt_results (
    ngrt_id           SERIAL PRIMARY KEY,
    student_id        INTEGER NOT NULL REFERENCES students(student_id),
    test_date         DATE,
    form              TEXT,     -- e.g. "A"
    sas               NUMERIC,
    pc_stanine        NUMERIC,
    sc_stanine        NUMERIC,
    overall_stanine   NUMERIC,
    reading_age       TEXT,     -- kept as text: source format is "YY:MM" (e.g. "10:08")
    UNIQUE (student_id, test_date)
);

CREATE INDEX idx_cat4_student ON cat4_results(student_id);
CREATE INDEX idx_ngrt_student ON ngrt_results(student_id);

ALTER TABLE cat4_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ngrt_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_all_cat4" ON cat4_results FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_cat4" ON cat4_results FOR ALL USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "read_all_ngrt" ON ngrt_results FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_ngrt" ON ngrt_results FOR ALL USING (is_admin()) WITH CHECK (is_admin());
