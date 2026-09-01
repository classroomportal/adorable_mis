INSERT INTO results (student_id, subject_id, week_start_date, score, max_score, grade, staff_id)
SELECT s.student_id, sub.subject_id, '2026-08-24', scores.score, 50, scores.grade, st.staff_id
FROM (VALUES
    ('Wilson', 'ENG', 40, 'A-'),
    ('Wilson', 'SCI', 35, 'B'),
    ('Chen', 'ENG', 30, 'C+'),
    ('Chen', 'SCI', 44, 'A'),
    ('Brown', 'MAT', 41, 'B+'),
    ('Brown', 'ENG', 46, 'A'),
    ('Brown', 'SCI', 39, 'B'),
    ('Garcia', 'MAT', 28, 'C'),
    ('Garcia', 'ENG', 33, 'C+'),
    ('Garcia', 'SCI', 37, 'B-'),
    ('Singh', 'MAT', 45, 'A'),
    ('Singh', 'ENG', 42, 'A-'),
    ('Singh', 'SCI', 47, 'A')
) AS scores(last_name, subject_code, score, grade)
JOIN students s ON s.last_name = scores.last_name
JOIN subjects sub ON sub.subject_code = scores.subject_code
JOIN staff st ON st.subject_specialism = sub.subject_name;
