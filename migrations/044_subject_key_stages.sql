-- ============================================
-- Migration 044: subject_key_stages
-- Tags a subject as belonging to one or more key stages (KS3/KS4/KS5).
-- A subject with NO rows here is untagged and shows at every key stage
-- (safe default so nothing disappears from transcripts until staff
-- actually tag subjects on /admin/subject-settings).
-- ============================================

create table subject_key_stages (
  id uuid primary key default gen_random_uuid(),
  subject_id integer references subjects(subject_id) on delete cascade,
  key_stage text not null check (key_stage in ('KS3', 'KS4', 'KS5')),
  unique (subject_id, key_stage)
);

alter table subject_key_stages enable row level security;

create policy "staff manage subject key stages" on subject_key_stages
  for all using (is_staff_or_admin());

create policy "authenticated read subject key stages" on subject_key_stages
  for select using (auth.uid() is not null);
