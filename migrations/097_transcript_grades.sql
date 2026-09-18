-- Migration 097: fixed-grid storage for the KS3/KS4-5 transcripts
--
-- The KS3/KS4-5 transcript (lib/generateKeyStageTranscript.js, added in
-- migration 095's follow-up) originally derived its columns dynamically —
-- one per term that happened to have a qualifying exam-grade result in the
-- weekly `results` table. House correction: each transcript needs a FIXED
-- column per (year group, term) across the whole key stage — e.g. KS3 is
-- always Y7 T1, Y7 T2, Y7 T3, Y8 T1, ... Y9 T3 (9 columns) — whether or not
-- a grade has been entered for that slot yet.
--
-- That fixed grid doesn't map cleanly onto `results`/`terms`: a term row in
-- `terms` is a real calendar period, not "the term a given student was in
-- Y7", and a transferring/repeating/historical student's Y7-T1 grade won't
-- reliably line up with any `results.week_start_date` at all — especially
-- for past students being imported from paper/legacy records next week.
-- So this is a dedicated table keyed directly by (student, subject, year
-- group, term number), fed by a one-off manual import (no UI/tile per
-- house decision — it's a single import job, not a recurring workflow),
-- not by the weekly results pipeline.

create table if not exists transcript_grades (
  student_id integer not null references students(student_id) on delete cascade,
  subject_id integer not null references subjects(subject_id),
  year_group smallint not null check (year_group between 7 and 12),
  term_number smallint not null check (term_number between 1 and 3),
  grade text not null references grade_scale(grade),
  is_demo boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  primary key (student_id, subject_id, year_group, term_number)
);

create trigger trg_set_is_demo
  before insert on transcript_grades
  for each row execute function set_is_demo();

alter table transcript_grades enable row level security;

-- Same shape as target_grades' policies (this is another kind of grade,
-- imported/maintained by the same assessment_manager/admin group).
create policy assessment_insert_transcript_grades on transcript_grades
  for insert with check (is_assessment_manager() and (is_demo = is_demo_account()));

create policy assessment_update_transcript_grades on transcript_grades
  for update using (is_assessment_manager() and (is_demo = is_demo_account()));

create policy assessment_delete_transcript_grades on transcript_grades
  for delete using (is_assessment_manager() and (is_demo = is_demo_account()));

create policy read_all_transcript_grades on transcript_grades
  for select using (is_staff_or_admin() and ((is_demo = is_demo_account()) or is_admin()));

create policy parent_read_own_transcript_grades on transcript_grades
  for select using (
    exists (
      select 1 from profiles p
      join student_parent sp on sp.parent_id = p.parent_id
      where p.id = auth.uid() and sp.student_id = transcript_grades.student_id
    )
  );

create policy student_read_own_transcript_grades on transcript_grades
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.student_id = transcript_grades.student_id
    )
  );
