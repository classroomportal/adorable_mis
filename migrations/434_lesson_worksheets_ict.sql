-- Migration 434: switch lesson worksheets and card sorts on for ICT.
--
-- Why: the principal, 10 Oct 2026: "ICT not coming up". Year 9's Digital
-- Literacy lessons are timetabled in Nova-T as ICT (9A1/It, 9C1/It, 9G1/It,
-- one lesson a week), so after migration 433 switched on Computing and
-- Digital Literacy the Year 9 worksheets and card sorts (Cambridge Lower
-- Secondary Digital Literacy 0082, Stage 9) had nowhere to go: the Lesson
-- worksheets panel only appears for subjects in lesson_worksheet_subjects.
--
-- Adds ICT (subject_id 302, code It) to the switch. Nothing else changes:
-- who can add a worksheet, when students can open it and the card-sort
-- answer key rules are as in migrations 428–433. Digital Technology and
-- Computer and GSM Repairs stay off.

set local formwork.change_note = 'Principal (direct)';

insert into public.lesson_worksheet_subjects (subject_id)
select s.subject_id from public.subjects s
where s.subject_id = 302 and s.subject_name = 'ICT'
on conflict (subject_id) do nothing;
