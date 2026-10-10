-- Migration 433: switch lesson worksheets and card sorts on for Computing
-- and Digital Literacy.
--
-- Why: the principal, 10 Oct 2026: "switch on Computing and Digital
-- Literacy". Worksheets and card sorts have been made for the last six
-- lessons of the term in both subjects for Years 7 and 8 (Cambridge Lower
-- Secondary Computing 0860 and Digital Literacy 0082), to be used on screen.
--
-- The trial switch is lesson_worksheet_subjects (migration 430), which has
-- no write grants, so a subject is added by migration. Computing (subject_id
-- 94, code Co) and Digital Literacy (192, code Dl) are both in the Creative
-- department alongside Art and Music, which is why the switch is by subject
-- and not by department. Every rule stays as it was: only whoever teaches or
-- leads a class of the subject and year (or its HoD, or admin) can add a
-- worksheet, students open it only once their lesson has started, and card
-- sort answer keys stay staff-only. Other digital subjects (ICT, Digital
-- Technology, Computer and GSM Repairs) are not switched on.

set local formwork.change_note = 'Principal (direct)';

insert into public.lesson_worksheet_subjects (subject_id)
select s.subject_id from public.subjects s
where s.subject_id in (94, 192)
  and s.subject_name in ('Computing', 'Digital Literacy')
on conflict (subject_id) do nothing;
