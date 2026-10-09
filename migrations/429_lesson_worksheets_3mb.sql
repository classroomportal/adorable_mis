-- Migration 429: lesson worksheets are at most 3 MB each.
--
-- Why: the principal, 9 Oct 2026, on hearing that a worksheet on every lesson
-- would be about 24,000 files a year: the 20 MB limit copied from homework
-- files (migration 281) let a few large scans use most of the space. 3 MB is
-- plenty for a worksheet PDF or document.
--
-- The bucket refuses a larger upload, and the row's size_bytes is checked too,
-- so the page's own check (lib/lessonWorksheets.js) isn't the only one.
-- Homework files keep their 20 MB.

set local formwork.change_note = 'Principal (direct)';

update storage.buckets set file_size_limit = 3145728 where id = 'lesson-worksheets';

alter table public.lesson_worksheets
  add constraint lesson_worksheets_size_check check (size_bytes is null or size_bytes <= 3145728);
