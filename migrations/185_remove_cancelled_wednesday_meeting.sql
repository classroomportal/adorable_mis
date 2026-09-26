-- Migration 185: remove the cancelled Wednesday Lesson 4 staff meeting.
--
-- Why: the school cancelled the Wednesday Lesson 4 meeting and uploaded an
-- updated NCLASS.DAT on 26 Sep 2026 without it. The meetings importer only
-- flagged old commitments for staff who appeared somewhere in the new file,
-- so it removed UMB's place in the meeting (UMB is in the SLT meeting) but
-- left the other 11 staff — BLK, CLI, CNS, CUE, ESO, FAW, LMU, OON, PMP,
-- STO, TAN — who had no other commitment. CUE's then showed as a clash with
-- 9G1/Bs. The importer now compares the file against every saved
-- commitment, so a cancelled meeting is offered for removal in future.
--
-- Wednesday Lesson 4 is period_number 5 (Registration is 1). Matches on
-- label, time and the exact 11 staff, and rolls back if that isn't what's
-- there.

do $$
declare
  n integer;
begin
  delete from staff_commitments sc
   using staff st
   where st.staff_id = sc.staff_id
     and sc.label = 'Meeting'
     and sc.day_of_week = 'Wed'
     and sc.period_number = 5
     and st.staff_code in ('BLK', 'CLI', 'CNS', 'CUE', 'ESO', 'FAW', 'LMU', 'OON', 'PMP', 'STO', 'TAN');
  get diagnostics n = row_count;
  if n <> 11 then
    raise exception 'expected to remove 11 Wednesday Lesson 4 meeting rows, matched %', n;
  end if;
  if exists (select 1 from staff_commitments where day_of_week = 'Wed' and period_number = 5 and label = 'Meeting') then
    raise exception 'a Wednesday Lesson 4 meeting row is still there';
  end if;
end $$;
