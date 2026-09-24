-- Migration 163: align staff_hr_profiles.department with the fixed list.
--
-- Why: Department on /staff/records was free text, and is now a dropdown of
-- HR's seven departments (Maths, Science, Languages, Creative, Pastoral,
-- Administration, Humanities — HR_DEPARTMENTS in lib/staffHr.js). One record
-- had been typed as 'ADMINISTRATION'; this folds it into the list's spelling so
-- it selects as Administration instead of showing as "not in list".
--
-- 'I.C.T' (one record on 24 September 2026) is left alone: it isn't one of the
-- seven and which of them it belongs to is HR's call. The form keeps showing it
-- as "I.C.T (not in list)" until someone picks a department. No check
-- constraint for the same reason — it would reject any save on that record.

update staff_hr_profiles
set department = 'Administration'
where upper(trim(department)) = 'ADMINISTRATION'
  and department is distinct from 'Administration';
