-- Rebuild timetable_slots with the full 9-period, 5-day structure.
-- Times: Period 1 (Registration) 08:00-08:20, then six 50-min teaching periods,
-- The Other Half 15:30-16:15, Evening Prep 19:00-20:00.
-- Only the 3 existing classes (Maths/English/Science) are scheduled here as placeholders —
-- add more classes/subjects and re-run similar inserts to fill the rest of the week.

DELETE FROM timetable_slots;

WITH period_times AS (
  SELECT * FROM (VALUES
    (1, TIME '08:00', TIME '08:20'),
    (2, TIME '08:20', TIME '09:10'),
    (3, TIME '09:10', TIME '10:00'),
    (4, TIME '10:20', TIME '11:10'),
    (5, TIME '11:10', TIME '12:00'),
    (6, TIME '13:00', TIME '13:50'),
    (7, TIME '13:50', TIME '14:40'),
    (8, TIME '15:30', TIME '16:15'),
    (9, TIME '19:00', TIME '20:00')
  ) AS t(period_number, start_time, end_time)
),
days AS (
  SELECT unnest(ARRAY['Mon','Tue','Wed','Thu','Fri']) AS day_of_week
)
INSERT INTO timetable_slots (class_id, day_of_week, period_number, start_time, end_time)
SELECT c.class_id, d.day_of_week, pt.period_number, pt.start_time, pt.end_time
FROM classes c
CROSS JOIN days d
CROSS JOIN period_times pt
WHERE pt.period_number IN (2, 3, 6)  -- placeholder: each class meets 3x/week across the 3 subjects
  AND (
    (c.room = 'M1' AND pt.period_number = 2) OR
    (c.room = 'E2' AND pt.period_number = 3) OR
    (c.room = 'S1' AND pt.period_number = 6)
  );
