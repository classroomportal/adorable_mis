-- Migration 253: Upload Documents page (/reports/documents).
--
-- Why: the school receives PDFs from outside Formwork (exam board results,
-- external reports) that need to reach each student's parents. Until now the
-- only documents parents could download were ones Formwork generated itself
-- (/reports/generate). /reports/documents takes a batch of PDFs, matches each
-- to a student by its file name, and publishes it under a title the uploader
-- chooses, which is what parents and students see in "Available documents".
--
-- No new table, bucket or policy is needed: the page writes to the existing
-- private student-documents bucket and student_documents table (migration
-- 095) with document_type = 'uploaded'. Their RLS already decides everything:
-- only admin, SMT and assessment managers can write; parents read only their
-- own children's documents, students only their own. So this only adds the
-- page to the permissions list, for the same roles the write policies allow.
-- Admins get it through has_resource_access() as usual.

set local formwork.change_note = 'Principal (direct)';

insert into resources (resource_key, label, section, sort_order) values
  ('/reports/documents', 'Upload Documents', 'Reports', 35)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('smt',                '/reports/documents'),
  ('assessment_manager', '/reports/documents')
on conflict do nothing;
