-- 425: Animal Husbandry's WAEC targets come from Biology
--
-- Why: the principal, 9 Oct 2026: "biology could be used for hb". Migration
-- 424 gave Years 10-11 WAEC targets in the WAEC-only subjects, from each
-- student's own target in the subject or, failing that, the average of
-- their other IGCSE targets. Nobody had an Animal Husbandry (subject 110,
-- "Hb") target, so all 26 came from the average. Biology (subject 89) is
-- the closer subject, and 26 of the 27 Year 10-11 Hb students have a
-- Biology target.
--
-- Hb now uses Biology's targets (subjects.target_fallback_subject_id, the
-- "Use targets from" setting on Subject Settings), and every active Year
-- 10-11 student enrolled in Hb with a Biology target gets that target in
-- WAEC (A* -> A1+, A -> A1, B -> B2, C -> C4, D -> C6, E -> E8, F/G/U ->
-- F9; a WAEC Biology target as it is). The one without keeps 424's.
-- Logged in grade_history by its trigger.

set local formwork.change_note = 'Principal (direct)';

update public.subjects
   set target_fallback_subject_id = 89
 where subject_id = 110;

with conv(igcse, waec) as (
  values ('A*', 'A1+'), ('A', 'A1'), ('B', 'B2'), ('C', 'C4'), ('D', 'C6'),
         ('E', 'E8'), ('F', 'F9'), ('G', 'F9'), ('U', 'F9'),
         ('A1+', 'A1+'), ('A1', 'A1'), ('B2', 'B2'), ('B3', 'B3'), ('C4', 'C4'),
         ('C5', 'C5'), ('C6', 'C6'), ('D7', 'D7'), ('E8', 'E8'), ('F9', 'F9')
),
hb as (
  select distinct st.student_id
    from public.student_class sc
    join public.classes c using (class_id)
    join public.students st using (student_id)
   where st.status = 'active' and st.year_group in (10, 11) and c.subject_id = 110
)
insert into public.target_grades (student_id, subject_id, target_grade)
select hb.student_id, 110, conv.waec
  from hb
  join public.target_grades bio on bio.student_id = hb.student_id and bio.subject_id = 89
  join conv on conv.igcse = bio.target_grade
on conflict (student_id, subject_id) do update
  set target_grade = excluded.target_grade
  where public.target_grades.target_grade is distinct from excluded.target_grade;
