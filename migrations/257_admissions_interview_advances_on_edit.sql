-- Migration 257: an interview saved or edited moves an invited applicant on.
--
-- Why: migration 256 moved an applicant from 'invited_to_interview' to
-- 'interviewed' only when the interview row was first inserted. The
-- applicant page lets the interview form be filled in at any stage, so an
-- interview started before the invitation was recorded never moved the
-- applicant on when it was completed later: the save was an update, not an
-- insert. Firing on update too fixes that. The function itself is unchanged
-- and still only moves applicants who are at 'invited_to_interview'.

set local formwork.change_note = 'Principal (direct)';

drop trigger if exists trg_advance_applicant on public.applicant_interviews;
create trigger trg_advance_applicant after insert or update on public.applicant_interviews
  for each row execute function public.advance_applicant_on_results();
