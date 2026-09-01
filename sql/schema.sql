-- Secondary School Database Schema
-- ~250 students: core data, parents, timetable, behaviour events, weekly results

CREATE TABLE students (
    student_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name      TEXT NOT NULL,
    last_name       TEXT NOT NULL,
    dob             DATE NOT NULL,
    year_group      INTEGER NOT NULL CHECK (year_group BETWEEN 7 AND 11),
    form_class      TEXT,
    admission_date  DATE,
    gender          TEXT,
    address         TEXT,
    medical_notes   TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left'))
);

CREATE TABLE parents (
    parent_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    phone            TEXT,
    email            TEXT,
    address          TEXT,
    relationship_type TEXT
);

CREATE TABLE student_parent (
    student_id        INTEGER NOT NULL REFERENCES students(student_id),
    parent_id         INTEGER NOT NULL REFERENCES parents(parent_id),
    is_primary_contact BOOLEAN NOT NULL DEFAULT 0,
    PRIMARY KEY (student_id, parent_id)
);

CREATE TABLE subjects (
    subject_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_name  TEXT NOT NULL,
    subject_code  TEXT UNIQUE
);

CREATE TABLE staff (
    staff_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name         TEXT NOT NULL,
    last_name          TEXT NOT NULL,
    subject_specialism TEXT
);

CREATE TABLE classes (
    class_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id  INTEGER NOT NULL REFERENCES subjects(subject_id),
    staff_id    INTEGER REFERENCES staff(staff_id),
    year_group  INTEGER NOT NULL,
    room        TEXT
);

CREATE TABLE timetable_slots (
    slot_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    class_id     INTEGER NOT NULL REFERENCES classes(class_id),
    day_of_week  TEXT NOT NULL CHECK (day_of_week IN ('Mon','Tue','Wed','Thu','Fri')),
    period_number INTEGER NOT NULL,
    start_time   TIME NOT NULL,
    end_time     TIME NOT NULL
);

CREATE TABLE student_class (
    student_id INTEGER NOT NULL REFERENCES students(student_id),
    class_id   INTEGER NOT NULL REFERENCES classes(class_id),
    PRIMARY KEY (student_id, class_id)
);

CREATE TABLE behaviour_events (
    event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  INTEGER NOT NULL REFERENCES students(student_id),
    staff_id    INTEGER REFERENCES staff(staff_id),
    event_date  DATE NOT NULL,
    event_time  TIME,
    type        TEXT NOT NULL CHECK (type IN ('positive','negative')),
    category    TEXT,
    points      INTEGER,
    description TEXT
);

CREATE TABLE results (
    result_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      INTEGER NOT NULL REFERENCES students(student_id),
    subject_id      INTEGER NOT NULL REFERENCES subjects(subject_id),
    week_start_date DATE NOT NULL,
    score           NUMERIC,
    max_score       NUMERIC,
    grade           TEXT,
    staff_id        INTEGER REFERENCES staff(staff_id),
    comments        TEXT
);

-- Helpful indexes
CREATE INDEX idx_results_student_week ON results(student_id, week_start_date);
CREATE INDEX idx_behaviour_student_date ON behaviour_events(student_id, event_date);
CREATE INDEX idx_studentclass_class ON student_class(class_id);
