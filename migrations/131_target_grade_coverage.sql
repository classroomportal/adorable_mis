-- Migration 131: report where a student has no target grade to show.
--
-- Why: a student should hold a target grade for every subject the school
-- issues them for, and the portals filter that set down to the subjects the
-- student actually takes — `visibleTargets(targets, results, enrolledSubjectIds)`
-- in /portal and /parent-portal. So a target for a subject a student does not
-- study is not an error and is never removed; it is the design. What matters
-- is the opposite: a subject a student DOES take where nothing can be shown.
--
-- Measured against that standard on 22 September 2026, the position is much
-- narrower than a count of unmatched rows suggests:
--
--   49 active students hold no target at all — every one of them a student
--      with no CAT4 result, so there was nothing to derive a target from.
--   200 students hold targets but take a subject with none available, across
--      just 9 subjects: Design Technology (84), Music (84), Digital Literacy
--      (50), Global Perspectives (50), Computer and GSM Repairs (48), Further
--      Maths (45), Hb (29), Fa (22), Gt (16). 428 rows in total.
--
-- Everything else is covered: of 225 active students holding targets, 181
-- hold exactly the 22-subject CAT4 basket and the rest hold 21 to 25.
--
-- This migration only measures. It deletes nothing, writes no target grade,
-- and adds no mechanism for doing either.

-- 1. Which subjects need a target at all -----------------------------------
--
-- Without this, every query that asks has to re-infer "not examined" from a
-- list of names. The nine seeded below are timetabled but carry no grade
-- anywhere in the school.

alter table subjects add column if not exists carries_target_grade boolean not null default true;

comment on column subjects.carries_target_grade is
  'False for timetabled but non-examined subjects (mentor time, sport, prep). '
  'A subject that carries no target can never be missing one.';

update subjects set carries_target_grade = false
where subject_name in (
  'Mentor', 'Mentor Group', 'Registration', 'Sports', 'Other Half',
  'Prep', 'Report/Prep', 'Personal Study', 'CCA'
);

-- 2. One definition of a missing target ------------------------------------
--
-- A row per subject a student takes and has nothing to show for. A target held
-- against the subject itself counts, and so does one held against the subject
-- it reads from (target_fallback_subject_id) — mapping Civics at Sociology
-- means Civics students can be shown Sociology's target, not that their own
-- Civics target is passed over.
--
-- security_invoker so the caller's RLS applies — the three views fixed in the
-- earlier security sweep were exactly this mistake. Active students only.

create or replace view target_grade_gaps
with (security_invoker = true) as
select distinct
  sc.student_id,
  c.subject_id,
  coalesce(sub.target_fallback_subject_id, c.subject_id) as read_target_from,
  not exists (
    select 1 from target_grades t2 where t2.student_id = sc.student_id
  ) as student_has_no_targets_at_all
from student_class sc
join students st on st.student_id = sc.student_id and st.status = 'active'
join classes c on c.class_id = sc.class_id
join subjects sub on sub.subject_id = c.subject_id
where sub.carries_target_grade
  and not exists (
    select 1 from target_grades t
    where t.student_id = sc.student_id
      and t.subject_id in (c.subject_id, sub.target_fallback_subject_id)
  );

comment on view target_grade_gaps is
  'One row per subject an active student takes with no target grade to show, '
  'counting both the subject''s own target and the one it reads from. Targets '
  'for subjects a student does not take are not listed: the school issues them '
  'for every subject and the portals filter by enrolment at display time.';

-- 3. The page --------------------------------------------------------------

insert into resources (resource_key, label, section, sort_order) values
  ('/target-grades/coverage', 'Target Grade Coverage', 'Assessment', 62)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('admin', '/target-grades/coverage'),
  ('assessment_manager', '/target-grades/coverage'),
  ('assessment_user', '/target-grades/coverage')
on conflict do nothing;
