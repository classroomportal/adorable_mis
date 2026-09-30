-- Migration 281: files and links attached to homework.
--
-- Why: the principal asked (30 Sept 2026) for teachers to be able to upload
-- files and add links to homework (worksheets, slides, a video or website).
-- This is the teacher's material for the students. Students handing work in
-- online is a separate decision ("not yet", docs/homework-design.md) and is
-- not added here.
--
-- Now:
--   * homework_attachments: one row per file or link on a homework. A link
--     must be an https:// address. A file lives in the private
--     'homework-files' bucket under '<homework_id>/…'.
--   * Who can add and remove them: whoever can set homework for the class
--     (can_set_homework(), migration 278). Nobody edits an attachment: it is
--     removed and added again.
--   * Who can see them: whoever can see the homework. The read policy asks
--     the homework table, so its own rules apply: all staff, and students in
--     the class while the homework is set. Parents get nothing, as for
--     homework itself.
--   * Files: 20 MB at most; PDF, Word, PowerPoint, Excel, OpenDocument,
--     images, plain text and CSV only (the bucket refuses anything else).
--     Files are opened through short-lived signed links, never public URLs.

set local formwork.change_note = 'Principal (direct)';

-- 1. The bucket -----------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('homework-files', 'homework-files', false, 20971520, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'text/csv'
])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. The attachments ---------------------------------------------------------------------

create table if not exists public.homework_attachments (
  attachment_id bigint generated always as identity primary key,
  homework_id bigint not null references public.homework(homework_id) on delete cascade,
  kind text not null check (kind in ('file', 'link')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  url text check (url is null or (url ~ '^https://[^\s<>"]+$' and char_length(url) <= 2000)),
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (
    (kind = 'link' and url is not null and storage_path is null)
    or (kind = 'file' and url is null and storage_path is not null)
  ),
  check (storage_path is null or storage_path like homework_id::text || '/%')
);

comment on table public.homework_attachments is
  'Files and links a teacher attaches to a homework (migration 281). Files are in the private homework-files bucket under <homework_id>/.';

create index if not exists homework_attachments_homework_idx on public.homework_attachments (homework_id);

alter table public.homework_attachments enable row level security;
grant select, insert, delete on public.homework_attachments to authenticated;

-- Whoever can see the homework (the homework table's own policies decide).
create policy "Homework attachments readable with the homework"
  on public.homework_attachments for select to authenticated
  using (exists (select 1 from homework h where h.homework_id = homework_attachments.homework_id));
create policy "Homework attachments added by those who teach the class"
  on public.homework_attachments for insert to authenticated
  with check (can_set_homework((select h.class_id from homework h where h.homework_id = homework_attachments.homework_id)));
create policy "Homework attachments removed by those who teach the class"
  on public.homework_attachments for delete to authenticated
  using (can_set_homework((select h.class_id from homework h where h.homework_id = homework_attachments.homework_id)));

create trigger trg_stamp_created_by before insert on public.homework_attachments
  for each row execute function public.stamp_actor('created_by');

-- 3. The files ----------------------------------------------------------------------------

-- May upload or remove a file at this storage path: the first folder must be
-- the id of a homework the caller can set. Parsed here, safely, rather than
-- cast inside a policy, where a malformed path would raise.
create or replace function public.can_manage_homework_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v_id !~ '^[0-9]{1,18}$' or split_part(p_name, '/', 2) = '' then
    return false;
  end if;
  return can_set_homework((select h.class_id from homework h where h.homework_id = v_id::bigint));
end;
$$;

revoke execute on function public.can_manage_homework_file(text) from public, anon;
grant execute on function public.can_manage_homework_file(text) to authenticated;

create policy homework_files_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'homework-files' and can_manage_homework_file(name));
create policy homework_files_remove on storage.objects
  for delete to authenticated
  using (bucket_id = 'homework-files' and can_manage_homework_file(name));
-- Readable only through an attachment row the caller can see.
create policy homework_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'homework-files' and exists (
    select 1 from homework_attachments a where a.storage_path = storage.objects.name));
