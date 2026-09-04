-- ============================================
-- Migration 045: subject_aliases
-- Permanent fix for the "recreated duplicate" problem: merge_subjects
-- only fixes existing rows, but the gradebook importer resolves subjects
-- purely by matching the parsed CSV header text against subjects.subject_name.
-- If the CSV wording ("Business Studies") never matches the real subject
-- name ("Business"), every future import recreates the duplicate.
--
-- This table lets staff say "this raw name means this existing subject",
-- checked by the importer BEFORE it falls back to creating a new subject.
-- ============================================

create table subject_aliases (
  alias_name text primary key,
  subject_id integer references subjects(subject_id) on delete cascade
);

alter table subject_aliases enable row level security;

create policy "staff manage subject aliases" on subject_aliases
  for all using (is_staff_or_admin());

create policy "authenticated read subject aliases" on subject_aliases
  for select using (auth.uid() is not null);
