-- Migration 131: a reviewable, reversible way to fix the target grade gaps.
--
-- Why: of 274 active students, 251 have a gap. 49 hold no target at all, and
-- 202 more are missing a target for a subject they actually study. The mirror
-- image is larger: 225 students hold targets for subjects they do not study —
-- 3,188 rows against 1,011 genuinely missing ones. /classes/progress compares
-- against those wrong rows today.
--
-- The cause is in /target-grades/import. It maps a fixed list of 22 columns
-- out of the CAT4 targets export and writes every one of them for every
-- student in the file, without reference to what that student is timetabled
-- for. CAT4 predicts a grade for its whole basket, so 224 students carry an
-- Add Maths target and nobody in the school takes Add Maths; Graphics has 220
-- targets against 5 students. Meanwhile the subjects the school teaches that
-- are NOT in that basket — Design Technology, Digital Literacy, Further Maths,
-- Computer and GSM Repairs — have no targets at all.
--
-- So this is a mapping problem before it is a deletion problem, and the schema
-- already has the mapping: subjects.target_fallback_subject_id means "the
-- subject whose target grade stands in for this one" and is how Business reads
-- Economics' target and Hu reads Sociology's. Pointing Further Maths at Add
-- Maths, for instance, would resolve 45 missing targets and 224 orphans at
-- once, with no rows written. Those mappings are the school's to decide and
-- are deliberately NOT guessed here: this migration builds the machinery and
-- leaves the mapping as data to fill in.
--
-- Nothing is deleted by running this migration. Removal happens later, from
-- /target-grades/reconcile, one reviewed run at a time, and every removed row
-- is kept so a run can be undone.

-- 1. Which subjects carry a target grade at all ---------------------------
--
-- Until now this was inferred by name in whatever query happened to be asking,
-- which is no basis for deleting anything. The nine seeded below are the ones
-- no student anywhere holds a target in and which are not examined subjects.
-- Everything else defaults to true, including the two-letter subjects left by
-- the Nova-T code import (He, Mu, Gl, Hb, Fa, Gt) — they are timetabled for
-- 18 to 130 students each and what they are is still unresolved, so they are
-- left visibly missing rather than quietly excluded.

alter table subjects add column if not exists carries_target_grade boolean not null default true;

comment on column subjects.carries_target_grade is
  'False for timetabled but non-examined subjects (mentor time, sport, prep). '
  'Drives target_grade_gaps: a subject that carries no target can never be missing one.';

update subjects set carries_target_grade = false
where subject_name in (
  'Mentor', 'Mentor Group', 'Registration', 'Sports', 'Other Half',
  'Prep', 'Report/Prep', 'Personal Study', 'CCA'
);

-- 2. One definition of a gap ----------------------------------------------
--
-- security_invoker so the caller's RLS applies — the three views fixed in the
-- earlier security sweep were exactly this mistake. Active students only:
-- leavers keep whatever they had.
--
-- A target already held against the subject itself is always legitimate, even
-- where a fallback mapping exists. That matters: mapping Civics at Sociology
-- would otherwise turn the 60 Civics targets already recorded into orphans and
-- offer them up for deletion. A mapping is a place to read a target FROM when
-- the subject has none of its own, never a reason to discard one somebody set.

create or replace view target_grade_gaps
with (security_invoker = true) as
with studied as (
  select distinct
    sc.student_id,
    c.subject_id,
    sub.target_fallback_subject_id
  from student_class sc
  join students st on st.student_id = sc.student_id and st.status = 'active'
  join classes c on c.class_id = sc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  where sub.carries_target_grade
),
-- every subject a target may legitimately sit against: the subject studied,
-- and the subject its target may be read from
acceptable as (
  select student_id, subject_id from studied
  union
  select student_id, target_fallback_subject_id from studied
  where target_fallback_subject_id is not null
)
select distinct
  s.student_id,
  -- reported against the mapped subject where there is one, since that is
  -- where a new target should be entered
  coalesce(s.target_fallback_subject_id, s.subject_id) as subject_id,
  'missing'::text as gap,
  null::text as target_grade
from studied s
where not exists (
  select 1 from target_grades t
  where t.student_id = s.student_id
    and t.subject_id in (s.subject_id, s.target_fallback_subject_id)
)
union all
select t.student_id, t.subject_id, 'orphan'::text, t.target_grade
from target_grades t
join students st on st.student_id = t.student_id and st.status = 'active'
where not exists (
  select 1 from acceptable a
  where a.student_id = t.student_id and a.subject_id = t.subject_id
);

comment on view target_grade_gaps is
  'One row per target grade problem for an active student. "missing" = studies '
  'the subject and holds no target for it or for the subject it is mapped to. '
  '"orphan" = holds a target for a subject they neither study nor map to. '
  'Setting target_fallback_subject_id resolves both sides at once, writing no rows.';

-- 3. Removals are staged, counted and reversible --------------------------

create table if not exists target_grade_cleanup_runs (
  run_id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  note text,
  removed_count integer not null default 0,
  undone_at timestamptz,
  undone_by uuid references profiles(id)
);

-- The removed rows themselves, so a run is undoable. This is the reason
-- cleanup goes through a function instead of a delete from the browser: the
-- copy and the delete have to be one transaction, or a failure halfway leaves
-- rows deleted with no record of what they were.
create table if not exists target_grade_removals (
  run_id bigint not null references target_grade_cleanup_runs(run_id) on delete cascade,
  student_id integer not null references students(student_id),
  subject_id integer not null references subjects(subject_id),
  target_grade text not null,
  primary key (run_id, student_id, subject_id)
);

-- 4. Apply / undo ---------------------------------------------------------

create or replace function apply_target_grade_cleanup(p_note text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_run_id bigint;
  v_count integer;
begin
  -- SECURITY DEFINER runs as the owner, so target_grade_gaps (security_invoker)
  -- sees every row rather than the caller's slice — which is what a school-wide
  -- cleanup needs. auth.uid() is still the caller, so this check is real.
  if not is_assessment_manager() then
    raise exception 'Only an admin or assessment manager can clean up target grades';
  end if;

  insert into target_grade_cleanup_runs (created_by, note)
  values (auth.uid(), p_note)
  returning run_id into v_run_id;

  insert into target_grade_removals (run_id, student_id, subject_id, target_grade)
  select v_run_id, g.student_id, g.subject_id, g.target_grade
  from target_grade_gaps g
  where g.gap = 'orphan';

  delete from target_grades t
  using target_grade_removals r
  where r.run_id = v_run_id
    and r.student_id = t.student_id
    and r.subject_id = t.subject_id;
  get diagnostics v_count = row_count;

  update target_grade_cleanup_runs set removed_count = v_count where run_id = v_run_id;
  return v_run_id;
end;
$$;

create or replace function undo_target_grade_cleanup(p_run_id bigint)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_count integer;
begin
  if not is_assessment_manager() then
    raise exception 'Only an admin or assessment manager can undo a target grade cleanup';
  end if;

  -- do nothing on conflict: a target set by hand since the run is the newer
  -- decision and is not overwritten by putting the old one back.
  insert into target_grades (student_id, subject_id, target_grade)
  select student_id, subject_id, target_grade
  from target_grade_removals
  where run_id = p_run_id
  on conflict (student_id, subject_id) do nothing;
  get diagnostics v_count = row_count;

  update target_grade_cleanup_runs
  set undone_at = now(), undone_by = auth.uid()
  where run_id = p_run_id and undone_at is null;

  return v_count;
end;
$$;

grant execute on function apply_target_grade_cleanup(text) to authenticated;
grant execute on function undo_target_grade_cleanup(bigint) to authenticated;

-- 5. RLS ------------------------------------------------------------------
--
-- Readable by assessment staff so the page can show run history; written only
-- through the two functions above.

alter table target_grade_cleanup_runs enable row level security;
alter table target_grade_removals enable row level security;

create policy assessment_read_cleanup_runs on target_grade_cleanup_runs
  for select using (is_assessment_manager() or has_staff_role(array['assessment_user']));

create policy assessment_read_cleanup_removals on target_grade_removals
  for select using (is_assessment_manager() or has_staff_role(array['assessment_user']));

-- 6. The page -------------------------------------------------------------

insert into resources (resource_key, label, section, sort_order) values
  ('/target-grades/reconcile', 'Reconcile Target Grades', 'Assessment', 62)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('admin', '/target-grades/reconcile'),
  ('assessment_manager', '/target-grades/reconcile')
on conflict do nothing;
