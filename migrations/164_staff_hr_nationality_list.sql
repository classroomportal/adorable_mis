-- Migration 164: staff nationality is one of Nigerian, British, Other.
--
-- Why: Nationality on /staff/records was free text and had already come in
-- as 'NIGERIAN' (4 records) beside 'British'. HR wants a fixed dropdown of
-- Nigerian / British / Other (NATIONALITIES in lib/staffHr.js).
--
-- Unlike Department (migration 163) every existing value maps onto the list,
-- so the database enforces it too: fold the uppercase spelling in, then add a
-- check constraint so a stray value can't come back in through another path.

update staff_hr_profiles
set nationality = initcap(lower(trim(nationality)))
where upper(trim(nationality)) in ('NIGERIAN', 'BRITISH', 'OTHER')
  and nationality is distinct from initcap(lower(trim(nationality)));

alter table staff_hr_profiles
  drop constraint if exists staff_hr_profiles_nationality_check;
alter table staff_hr_profiles
  add constraint staff_hr_profiles_nationality_check
  check (nationality is null or nationality in ('Nigerian', 'British', 'Other'));
