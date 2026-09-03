-- 029_student_photos.sql
-- Item 9 on the to-do list: student photos, shown large enough to recognise.
-- Stored as base64 JPEG text directly on the student row — the whole photo set is ~4MB total,
-- comfortably within Postgres TOAST limits, so no separate object storage bucket is needed.

ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_base64 TEXT;
