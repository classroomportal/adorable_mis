-- Migration 095: persistent storage for staff-published student documents
--
-- Today the "Download Report" button (lib/generateTranscript.js) builds a PDF
-- entirely in the browser and hands it straight to the user — nothing is ever
-- saved server-side, so there's no record of what was actually produced/sent,
-- and no way for a parent to get a copy later without regenerating it live.
--
-- This adds a generic store for staff-published documents (transcripts today;
-- termly narrative reports and fee invoices are expected to reuse the same
-- table/bucket later — hence the free-text document_type rather than a
-- dedicated table per document kind). The existing live-download button is
-- left untouched; this is an additional "generate & publish" path used by the
-- new /reports/generate page.
--
-- One row per (student_id, document_type, term_id): regenerating overwrites
-- the previous copy rather than keeping history, per house decision.

insert into storage.buckets (id, name, public)
values ('student-documents', 'student-documents', false)
on conflict (id) do nothing;

create table if not exists student_documents (
  id bigserial primary key,
  student_id integer not null references students(student_id) on delete cascade,
  document_type text not null,
  term_id integer references terms(term_id) on delete set null,
  title text not null,
  storage_path text not null,
  generated_at timestamptz not null default now(),
  generated_by uuid references profiles(id),
  is_demo boolean not null default false,
  unique (student_id, document_type, term_id)
);

create trigger trg_set_is_demo
  before insert on student_documents
  for each row execute function set_is_demo();

alter table student_documents enable row level security;

-- Broad staff read (any staff role can see what's been published for a
-- student they can already look up), same is_demo scoping as every other
-- staff_read_* policy in this schema.
create policy staff_read_student_documents on student_documents
  for select using (is_staff_or_admin() and ((is_demo = is_demo_account()) or is_admin()));

-- Only the roles that actually run report periods can generate/publish or
-- remove a document. The training account is blocked outright (same stance
-- as send_message() in migration 081) rather than sandboxed, since this is a
-- real side-effecting write, not a read.
create policy staff_manage_student_documents on student_documents
  for all
  using (user_has_staff_role(array['admin', 'smt', 'assessment_manager']) and not is_demo_account())
  with check (user_has_staff_role(array['admin', 'smt', 'assessment_manager']) and not is_demo_account());

create policy parent_read_own_student_documents on student_documents
  for select using (
    exists (
      select 1 from profiles p
      join student_parent sp on sp.parent_id = p.parent_id
      where p.id = auth.uid() and sp.student_id = student_documents.student_id
    )
  );

create policy student_read_own_student_documents on student_documents
  for select using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.student_id = student_documents.student_id
    )
  );

-- Storage: writes are staff-only (and blocked for the demo account); reads
-- are scoped per-row via the student_documents metadata row for that path,
-- so a parent/student can only fetch their own linked student's file and a
-- demo-tagged file only shows up for the demo account or an admin.
create policy staff_write_student_documents_storage on storage.objects
  for all
  using (bucket_id = 'student-documents' and user_has_staff_role(array['admin', 'smt', 'assessment_manager']) and not is_demo_account())
  with check (bucket_id = 'student-documents' and user_has_staff_role(array['admin', 'smt', 'assessment_manager']) and not is_demo_account());

create policy staff_read_student_documents_storage on storage.objects
  for select using (
    bucket_id = 'student-documents'
    and is_staff_or_admin()
    and exists (
      select 1 from student_documents sd
      where sd.storage_path = storage.objects.name
        and ((sd.is_demo = is_demo_account()) or is_admin())
    )
  );

create policy parent_read_own_student_documents_storage on storage.objects
  for select using (
    bucket_id = 'student-documents'
    and exists (
      select 1 from student_documents sd
      join profiles p on p.id = auth.uid()
      join student_parent sp on sp.parent_id = p.parent_id and sp.student_id = sd.student_id
      where sd.storage_path = storage.objects.name
    )
  );

create policy student_read_own_student_documents_storage on storage.objects
  for select using (
    bucket_id = 'student-documents'
    and exists (
      select 1 from student_documents sd
      join profiles p on p.id = auth.uid() and p.student_id = sd.student_id
      where sd.storage_path = storage.objects.name
    )
  );
