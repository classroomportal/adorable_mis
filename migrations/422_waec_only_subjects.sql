-- 422: mark the subjects Years 10 and 11 sit for WAEC only
--
-- Why: the principal, 9 Oct 2026: on Years 10 and 11's printed reports of
-- grades and targets, the subjects sat for WAEC only must be graded in
-- WAEC, in their own section under the IGCSE subjects, with the target
-- converted from the student's IGCSE target. Those subjects are Igbo,
-- Government, Computer and GSM Repairs, Husbandry (subject "Hb", shown as
-- Animal Husbandry), Fashion and Civics (shown as Citizenship and National
-- Heritage).
--
-- Which subjects they are is data, not code: subjects.waec_only. The
-- Termly Grade Report (lib/generateTermTestScores.js) and the written
-- report's Grade line (lib/generateWrittenReport.js) read it for Years
-- 10-11 only; Years 7-9 stay IGCSE and Year 12 is WAEC already. The WAEC
-- grade and target are worked out when the report is printed (Year 12's
-- WAEC boundaries for the subject, as the KS4/5 transcript does), never
-- stored, so target_grades keeps the IGCSE target and a changed boundary
-- or target shows on the next print.
--
-- Computer and GSM Repairs had no key stage at all, so it never reached
-- the Termly Grade Report (which shows only subjects tagged for the
-- student's key stage). It is taught in Years 10-11 only, so it gets KS4.

set local formwork.change_note = 'Principal (direct)';

alter table public.subjects
  add column if not exists waec_only boolean not null default false;

comment on column public.subjects.waec_only is
  'Sat for WAEC only in Years 10-11: graded in WAEC, in its own section, on their printed reports (migration 422).';

update public.subjects
   set waec_only = true
 where subject_id in (
   306,  -- Igbo (Ng)
   109,  -- Government (Gt)
   314,  -- Computer and GSM Repairs (Gs)
   110,  -- Hb, Animal Husbandry
   101,  -- Fashion (Fa)
   93    -- Civics, Citizenship and National Heritage (Cv)
 );

insert into public.subject_key_stages (subject_id, key_stage)
select 314, 'KS4'
 where not exists (
   select 1 from public.subject_key_stages where subject_id = 314 and key_stage = 'KS4'
 );
