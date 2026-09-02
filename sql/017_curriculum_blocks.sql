-- 017_curriculum_blocks.sql
-- Lets staff allocate a student to one class per curriculum block (Maths sets, Options, MFL, etc.)
-- instead of relying only on SIMS re-imports.

CREATE TABLE IF NOT EXISTS curriculum_blocks (
    block_id     SERIAL PRIMARY KEY,
    block_name   TEXT NOT NULL,
    year_group   INTEGER NOT NULL,
    band         TEXT,
    UNIQUE (block_name, year_group, band)
);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS block_id INTEGER REFERENCES curriculum_blocks(block_id);

-- Denormalised block_id on student_class so we can enforce 'one class per block per student' at the DB level
ALTER TABLE student_class ADD COLUMN IF NOT EXISTS block_id INTEGER REFERENCES curriculum_blocks(block_id);

CREATE OR REPLACE FUNCTION set_student_class_block_id() RETURNS TRIGGER AS $$
BEGIN
    SELECT block_id INTO NEW.block_id FROM classes WHERE class_id = NEW.class_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_student_class_block_id ON student_class;
CREATE TRIGGER trg_set_student_class_block_id
    BEFORE INSERT OR UPDATE OF class_id ON student_class
    FOR EACH ROW EXECUTE FUNCTION set_student_class_block_id();

-- One class per block per student (only enforced where the class actually belongs to a block)
DROP INDEX IF EXISTS uq_student_class_block;
CREATE UNIQUE INDEX uq_student_class_block ON student_class (student_id, block_id) WHERE block_id IS NOT NULL;

-- 1. Blocks themselves
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Other Half sets', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Maths sets', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Sports', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('PE Practical', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor Teaching Groups', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Prep sets', 7, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Prep sets', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Other Half sets', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Sports', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('PE Practical', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor Teaching Groups', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Maths sets', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor', 9, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Other Half sets', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Maths', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Option', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Prep sets', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Sports', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('MFL', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Pathway', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Vocational', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('English sets', 10, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Other Half sets', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Sports', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Prep sets', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Maths sets', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor Teaching Group', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('PE Practical', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor', 8, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Other Half sets', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Prep sets', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Choice 2', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Vocational', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('English', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Maths', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Pathway', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Civics', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Choice 1', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor', 12, 'a') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('English sets', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Vocational', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Pathway', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('MFL', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Prep sets', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Maths', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Option', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Mentor', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;
INSERT INTO curriculum_blocks (block_name, year_group, band) VALUES ('Other Half sets', 11, 'w') ON CONFLICT (block_name, year_group, band) DO NOTHING;

-- 2. Link existing classes to their block
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Other Half sets' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Oh1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Ma1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Ma2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Ma3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Sports' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '77/Sa1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Me1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Me2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Me3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'PE Practical' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7BOY';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'PE Practical' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7GIR';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Groups' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7A';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Groups' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7C';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Groups' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7G';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 7 AND band = 'a' LIMIT 1) WHERE class_code = '7a/Pr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Pr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Pr3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Other Half sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Oh1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Sports' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '98/Sa1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'PE Practical' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9BOY';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'PE Practical' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9GIR';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Groups' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '91';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Groups' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '92';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Groups' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '93';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Ma1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Ma2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Ma3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Me1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Me2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 9 AND band = 'a' LIMIT 1) WHERE class_code = '9a/Me3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Other Half sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Oh1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10_1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10_2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10_3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10_4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Pe1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Fd1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Gr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Fm1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Hi1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Gy1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Ec1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10B/Ar1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Pr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Pr3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me5';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me6';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me7';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me8';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Me9';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Sports' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '109/Sa1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Sports' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '109/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Fr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Ci1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Sp1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Ng1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/Fr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '101';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '102';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '103';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10LI';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10HB';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10FA';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10D1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10D2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/En1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/En2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/En3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 10 AND band = 'a' LIMIT 1) WHERE class_code = '10a/En4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Other Half sets' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Oh1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Sports' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '87/Sa1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Pr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Ma1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Ma2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths sets' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Ma3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Group' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8A';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Group' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8C';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor Teaching Group' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8G';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'PE Practical' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8BOY';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'PE Practical' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8GIR';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Me1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Me2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 8 AND band = 'a' LIMIT 1) WHERE class_code = '8a/Me3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Other Half sets' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Oh1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Pr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 2' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12B/Co1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 2' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12B/Ec1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 2' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12B/Ar1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 2' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12B/Fr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Mk1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Ca1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Mk2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/En1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/En2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/En3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12_1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12_2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12_3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Bi1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Bi2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/El1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Civics' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Cv1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Civics' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12a/Cv2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 1' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12A/Fd1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 1' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12A/Gr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 1' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12A/Fm1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 1' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12A/Hi1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Choice 1' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12A/Gy1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12A';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12C';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 12 AND band = 'a' LIMIT 1) WHERE class_code = '12G';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/En1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/En2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/En3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'English sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/En4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11HB';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11FA';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11D1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11D2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11X';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Vocational' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11EC';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '111';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '112';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '113';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Pathway' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11LI';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Fr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Ci1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Sp1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Ng1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'MFL' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Fr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Pr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Pr2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Pr3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Prep sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Pr4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11_1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11_2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11_3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Maths' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11_4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Pe1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Fd1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Gr1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Fm1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Hi1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Gy1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Ec1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Option' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11B/Ar1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me1';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me2';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me3';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me4';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me5';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me6';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me7';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Mentor' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Me8';
UPDATE classes SET block_id = (SELECT block_id FROM curriculum_blocks WHERE block_name = 'Other Half sets' AND year_group = 11 AND band = 'w' LIMIT 1) WHERE class_code = '11w/Oh1';

-- 3. Backfill block_id on existing student_class rows (the trigger only fires on new writes)
UPDATE student_class sc SET block_id = c.block_id FROM classes c WHERE sc.class_id = c.class_id AND c.block_id IS NOT NULL;
