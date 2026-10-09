-- 424: give Years 10-11 WAEC targets in the subjects they sit for WAEC only
--
-- Why: the principal, 9 Oct 2026: "calculate and create WAEC targets using
-- the scale". Migrations 422-423 flag the WAEC-only subjects (Igbo,
-- Government, Computer and GSM Repairs, Animal Husbandry, Fashion, Civics,
-- Digital Technologies), and the Termly Grade Report converted their IGCSE
-- target at print time. But most students had no target in these subjects
-- at all (Fashion 0 of 24, Government 0 of 19, Animal Husbandry 0 of 27,
-- Civics 8 of 111, Computer and GSM Repairs 1 of 59), so there was
-- nothing to convert. Only Digital Technologies had them (105 of 111).
--
-- For every active Year 10-11 student enrolled in a WAEC-only subject,
-- the target becomes a WAEC grade on the scale lib/waecSubjects.js uses
-- (A* -> A1+, A -> A1, B -> B2, C -> C4, D -> C6, E -> E8, F/G/U -> F9),
-- worked out from:
--   1. their own IGCSE target in that subject, if they have one (a WAEC
--      target already there is kept);
--   2. otherwise the average of their IGCSE targets in the subjects they
--      are enrolled in that aren't WAEC-only (grade_scale points A* = 8
--      ... G = 1, rounded to the nearest grade).
-- A student with neither (20 on 9 Oct 2026) gets no target here.
--
-- Stored in target_grades (one row per student and subject), so every page
-- that shows targets now shows the WAEC one, and Class Progress compares
-- WAEC grades with it. Every change is logged in grade_history by its
-- trigger. Targets written later (a CAT4 import, a teacher) in IGCSE are
-- still converted on the printed report.

set local formwork.change_note = 'Principal (direct)';

with conv(igcse, waec) as (
  values ('A*', 'A1+'), ('A', 'A1'), ('B', 'B2'), ('C', 'C4'), ('D', 'C6'),
         ('E', 'E8'), ('F', 'F9'), ('G', 'F9'), ('U', 'F9')
),
pts as (
  select grade, points::numeric as p
    from public.grade_scale
   where grade in ('A*', 'A', 'B', 'C', 'D', 'E', 'F', 'G')
),
enrolled as (
  select distinct st.student_id, c.subject_id
    from public.student_class sc
    join public.classes c using (class_id)
    join public.students st using (student_id)
    join public.subjects s on s.subject_id = c.subject_id
   where st.status = 'active' and st.year_group in (10, 11) and s.waec_only
),
average_target as (
  select t.student_id, round(avg(pts.p)) as p
    from public.target_grades t
    join pts on pts.grade = t.target_grade
    join public.subjects s on s.subject_id = t.subject_id
   where not s.waec_only
     and exists (
       select 1 from public.student_class sc join public.classes c using (class_id)
        where sc.student_id = t.student_id and c.subject_id = t.subject_id
     )
   group by t.student_id
),
calculated as (
  select e.student_id, e.subject_id, t.target_grade as current_target,
         coalesce(
           (select waec from conv where waec = t.target_grade),
           (select waec from conv where igcse = t.target_grade),
           (select conv.waec from pts join conv on conv.igcse = pts.grade where pts.p = a.p)
         ) as waec_target
    from enrolled e
    left join public.target_grades t on t.student_id = e.student_id and t.subject_id = e.subject_id
    left join average_target a on a.student_id = e.student_id
)
insert into public.target_grades (student_id, subject_id, target_grade)
select student_id, subject_id, waec_target
  from calculated
 where waec_target is not null
   and waec_target is distinct from current_target
on conflict (student_id, subject_id) do update
  set target_grade = excluded.target_grade;
