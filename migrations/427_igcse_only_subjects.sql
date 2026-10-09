-- 427: mark the subjects Years 10 and 11 sit for IGCSE only
--
-- Why: the principal, 9 Oct 2026: "Chinese and Spanish are iGCSE only
-- subjects so need to be [in] another section". Since migration 422 a Year
-- 10-11 Termly Grade Report has had two sections, "IGCSE and WAEC
-- Subjects" and "WAEC Only Subjects". It now has a third between them,
-- "IGCSE Only Subjects", for the subjects flagged here. Their grades and
-- targets stay IGCSE; only where they are printed changes.
--
-- Like waec_only it is data, the IGCSE only tick on Subject Settings. A
-- subject can't be both (check constraint). Within each section English
-- and Mathematics now come first (lib/generateTermTestScores.js).

set local formwork.change_note = 'Principal (direct)';

alter table public.subjects
  add column if not exists igcse_only boolean not null default false;

comment on column public.subjects.igcse_only is
  'Sat for IGCSE only in Years 10-11: printed in its own section on their Termly Grade Report (migration 427).';

alter table public.subjects
  add constraint subjects_not_igcse_and_waec_only check (not (igcse_only and waec_only));

update public.subjects
   set igcse_only = true
 where subject_id in (
   298,  -- Chinese (Ci)
   128   -- Spanish (Sp)
 );
