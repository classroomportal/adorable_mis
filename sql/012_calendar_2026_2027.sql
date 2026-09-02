-- Generic calendar events table (ReLPs, exams, consult days, awareness days, holidays, etc.)
CREATE TABLE calendar_events (
    event_id    SERIAL PRIMARY KEY,
    event_date  DATE NOT NULL,
    event_name  TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN (
        'term_boundary', 'relp', 'exam', 'consult_day', 'awareness_day', 'holiday', 'other'
    )),
    year_group_note TEXT  -- e.g. "Y7/12" for consult days that only apply to specific years
);

CREATE INDEX idx_calendar_events_date ON calendar_events(event_date);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_all_calendar_events" ON calendar_events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "admin_write_calendar_events" ON calendar_events FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Replace placeholder term with the real 2026-2027 academic year
DELETE FROM terms WHERE term_name = 'Autumn Term 2026';

INSERT INTO terms (term_name, start_date, end_date) VALUES
('September Term 2026', '2026-09-18', '2026-12-04'),
('January Term 2027', '2027-01-10', '2027-03-28'),
('Summer Term 2027', '2027-04-18', '2027-07-10');

-- Full calendar of named events
INSERT INTO calendar_events (event_date, event_name, category, year_group_note) VALUES
-- September Term
('2026-09-18', 'New students return', 'term_boundary', NULL),
('2026-09-20', 'Old students return', 'term_boundary', NULL),
('2026-10-02', 'Big ReLP', 'relp', NULL),
('2026-10-05', 'World Teachers Day', 'awareness_day', NULL),
('2026-10-09', 'Core ReLP', 'relp', NULL),
('2026-10-23', 'Mid Term tests', 'exam', NULL),
('2026-10-24', 'Mid Term / Consult Day', 'consult_day', 'Y7/12'),
('2026-11-01', 'All students return', 'term_boundary', NULL),
('2026-11-06', 'Core ReLP', 'relp', NULL),
('2026-11-13', 'Core ReLPs', 'relp', NULL),
('2026-11-17', 'Anti Bullying Day', 'awareness_day', NULL),
('2026-11-20', 'Big ReLP', 'relp', NULL),
('2026-11-30', 'End of Term Exams', 'exam', NULL),
('2026-12-04', 'Christmas Evensong', 'other', NULL),

-- January Term
('2027-01-10', 'Students Return', 'term_boundary', NULL),
('2027-01-14', 'Wear it Blue Day', 'awareness_day', NULL),
('2027-01-15', 'Core ReLP', 'relp', NULL),
('2027-01-22', 'Core ReLP', 'relp', NULL),
('2027-01-24', 'Careers Day / World Education Day', 'awareness_day', NULL),
('2027-01-29', 'Big ReLP', 'relp', NULL),
('2027-02-02', 'Core ReLP', 'relp', NULL),
('2027-02-05', 'Core ReLP', 'relp', NULL),
('2027-02-12', 'Big ReLP', 'relp', NULL),
('2027-02-13', 'Mid term', 'holiday', NULL),
('2027-02-21', 'All students return', 'term_boundary', NULL),
('2027-02-26', 'Core ReLP', 'relp', NULL),
('2027-03-05', 'Core ReLP', 'relp', NULL),
('2027-03-09', 'International Women''s Day', 'awareness_day', NULL),
('2027-03-12', 'Big ReLP', 'relp', NULL),
('2027-03-14', 'Cultural Day', 'awareness_day', NULL),
('2027-03-17', 'EOT Exams', 'exam', NULL),
('2027-03-24', 'Students leave for Easter / Extension lessons', 'term_boundary', NULL),
('2027-03-28', 'Easter Sunday', 'holiday', NULL),

-- Summer Term
('2027-04-18', 'Students Return', 'term_boundary', NULL),
('2027-04-23', 'Core ReLP', 'relp', NULL),
('2027-04-30', 'Core ReLP', 'relp', NULL),
('2027-05-07', 'Big ReLPs', 'relp', NULL),
('2027-05-17', 'Mid Term Tests', 'exam', NULL),
('2027-05-22', 'Start of Mid-Term / Consult Day', 'consult_day', 'Y9/11'),
('2027-05-30', 'Students Return', 'term_boundary', NULL),
('2027-06-04', 'Core ReLP', 'relp', NULL),
('2027-06-11', 'Core ReLP', 'relp', NULL),
('2027-06-16', 'Day of the African Child', 'awareness_day', NULL),
('2027-06-18', 'All Subject ReLPs', 'relp', NULL),
('2027-06-25', 'Core ReLP', 'relp', NULL),
('2027-07-03', 'End of Term Exams', 'exam', NULL),
('2027-07-10', 'Graduation', 'other', NULL);
