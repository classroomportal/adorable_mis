-- 423: Digital Technologies is sat for WAEC only in Years 10-11 too
--
-- Why: the principal, 9 Oct 2026, adding to migration 422's list: "Needs
-- to include Digital technologies". That is subject 94 (subject_name
-- Computing, code Co, shown as Digital Technologies), taught in 101/Co,
-- 102/Co, 103/Co, 10LI/Co, 11D1/Co, 11D2/Co, 11FA/Co and 11HB/Co. Subject
-- 315 "Digital Technology" (Dc) has no classes and is left alone.
--
-- Its Year 10-11 boundaries are Cambridge's (migration 322: A* from
-- 76.67%, B from 44.67%), so converting a target through the bottom of
-- its IGCSE band would have turned a B into E8. lib/waecSubjects.js now
-- converts targets grade for grade (A* -> A1+, A -> A1, B -> B2, C -> C4,
-- D -> C6, E -> E8, F/G/U -> F9), which is what 422's subjects got anyway
-- on their standard boundaries.

set local formwork.change_note = 'Principal (direct)';

update public.subjects
   set waec_only = true
 where subject_id = 94;  -- Computing (Co), Digital Technologies
