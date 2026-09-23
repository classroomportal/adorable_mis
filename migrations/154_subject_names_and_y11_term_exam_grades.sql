-- Migration 154: tidy three subjects, and give the Year 11 July term-exam
-- scores the grades they arrived without.
--
-- 1. "Gt" and "Fa" were created with their Nova-T codes as their names
--    (display_name already said Government and Fashion). subject_name is what
--    most pages fall back to, so it now says the real name too. subject_code
--    stays as it was, so Nova-T imports still match.
--
-- 2. Digital Technology had no subject_code, so a Nova-T import could never
--    resolve a class to it. "Dc" is the code Nova-T uses. The school plans to
--    rationalise the computing/IT subject codes later; when that happens this
--    is one of the codes to revisit.
--
-- 3. The July 2026 term-exam import (result_type 'term_exam_import', done
--    directly against the database) stored scores but no grade for every
--    Year 11 student in six subjects: Civics, Digital Technology, Computer
--    and GSM Repairs, Government, Fashion and Igbo (161 rows). The school's
--    sheet gave no grade for them, and its other Year 11 grades don't follow
--    one scale that could be copied. So these are graded from the MIS's own
--    Year 11 boundaries (subject_grade_boundaries).
--
--    The bands are whole numbers (A 80–89, A* 90–100) but some scores aren't,
--    so 11 of them (e.g. 89.33) fall between two bands. Each score gets the
--    highest band whose min_score it has reached: 89.33 is an A because it
--    hasn't reached 90. No score is rounded up into a higher grade.
--
--    Only rows that still have no grade are touched, so re-running this
--    changes nothing and never overwrites a grade someone has since entered.

-- 1.
update public.subjects set subject_name = 'Government' where subject_id = 109 and subject_name = 'Gt';
update public.subjects set subject_name = 'Fashion'    where subject_id = 101 and subject_name = 'Fa';

-- 2.
update public.subjects set subject_code = 'Dc' where subject_id = 315 and subject_code is null;

-- 3.
update public.results r
set grade = (
  select b.grade
  from public.subject_grade_boundaries b
  where b.subject_id = r.subject_id
    and b.year_group = 11
    and b.min_score <= r.score
  order by b.min_score desc
  limit 1
)
from public.students st
where st.student_id = r.student_id
  and st.year_group = 11
  and r.result_type = 'term_exam_import'
  and r.week_start_date = date '2026-07-19'
  and r.grade is null
  and r.score is not null
  and r.subject_id in (93, 101, 109, 306, 314, 315);
