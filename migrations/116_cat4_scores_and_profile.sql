-- Migration 116: CAT4 standardised age scores from the same sheet as 115,
-- and somewhere to keep the verbal-spatial profile.
--
-- Source: "CAT4_Predicted_Grades.xlsx", sheet "CAT4 Merged" -- the same 30
-- rows whose target grades went in with migration 115, here for the SAS
-- columns (verbal, quantitative, non-verbal, spatial, mean) and the
-- "Verbal-Spatial profile" text. The same 25-of-30 resolve to a student on
-- roll; the five listed in 115's header are still not admitted and are not
-- covered here either.
--
-- Two things worth knowing before reading the DML.
--
-- test_date is left NULL, deliberately. The sheet has no date column and
-- nothing else in it dates the sitting. Every other row in cat4_results
-- carries a real date, so rather than infer one from what the student's year
-- group peers sat, these rows say "score known, date not". The cost is real
-- and is accepted: cat4_results is unique on (student_id, test_date), and
-- /students/[id] orders by test_date desc, which in Postgres is NULLS FIRST
-- -- so if a dated result for one of these students is imported later it
-- will sit alongside the dateless row rather than replace it, and will sort
-- below it. If the school produces the sitting dates, set them here and both
-- problems go away. level is NULL for the same reason: not in the sheet.
--
-- Twelve of the 25 had no cat4_results row at all and get one. The other
-- thirteen already had this exact sitting on record -- same four SAS scores,
-- same mean -- so they are not re-inserted; they only get the new profile
-- column backfilled.
--
-- The one exception is Ifechuwku NWANZE (R703939825082), where the sheet and
-- the record disagree:
--     on record (2026-05-14):  V 81  Q 81  NV 88  S 87  mean 84
--     sheet:                   V 81  Q 91  NV 94  S 66  mean 83
-- Both are internally consistent -- each mean is the average of its own four
-- scores -- so there is no way to tell from the data which sitting is right,
-- and overwriting a child's assessment record on a coin flip is not this
-- migration's call. The update below is keyed on the four SAS scores
-- matching, so her row is left exactly as it is, profile included, until
-- someone checks the GL Assessment report.

begin;

alter table cat4_results add column if not exists profile text;

comment on column cat4_results.profile is
  'CAT4 verbal-spatial profile as reported by GL Assessment, e.g. "No bias", '
  '"Mild verbal bias", "Moderate spatial bias". Free text, nullable -- older '
  'rows predate the column and are not backfilled.';

create temporary table cat4_sheet_scores (
  upn text not null,
  verbal numeric,
  quantitative numeric,
  non_verbal numeric,
  spatial numeric,
  mean numeric,
  profile text
) on commit drop;

insert into cat4_sheet_scores (upn, verbal, quantitative, non_verbal, spatial, mean, profile) values
  ('E703939825115', 101, 102, 102,  93, 100, 'No bias'),  -- Chukwuebuka AYOGU
  ('V703939825136', 112,  98,  98, 101, 102, 'Mild verbal bias'),  -- UGWU Chidubem David  [sheet id "New01"]
  ('N703939826023', 102, 109, 105,  77,  98, 'Moderate verbal bias'),  -- David Chiedozie  [sheet id "20016"]
  ('D703939825099', 114, 102,  99,  96, 103, 'Moderate verbal bias'),  -- Chukwusom EZEANI
  ('L703939826012', 112, 114, 113, 102, 110, 'Mild verbal bias'),  -- Stephanie EZEWEPUTA
  ('Z703939825102', 108, 110, 115, 101, 109, 'No bias'),  -- Chizitere HARFORD
  ('N703939825103',  93, 110, 110,  95, 102, 'No bias'),  -- Jaden HARFORD
  ('Y703939825138', 105,  97,  88,  96,  97, 'Mild verbal bias'),  -- Kenenna NWABUEZE
  ('P703939825098', 108,  96, 103, 101, 102, 'No bias'),  -- Chizobam NWANNA-ANUNASO
  ('R703939825082',  81,  91,  94,  66,  83, 'No bias'),  -- Ifechuwku NWANZE
  ('D703939826015', 104, 117, 111, 119, 113, 'Mild spatial bias'),  -- Chimamanda NWEKE
  ('Z703939825077', 115, 105, 114, 100, 109, 'Mild verbal bias'),  -- Divine Favour UGWUMGBOR
  ('P703939826014', 109, 109, 104, 100, 106, 'No bias'),  -- Uchenna MADUAKOLAM
  ('C703939825081',  83,  80,  74,  68,  76, 'Mild verbal bias'),  -- Chidinma NWIFURU
  ('N703939825080',  90,  80,  73,  95,  85, 'No bias'),  -- Onyedikachi Ezeani  [sheet id "Yr8Jan"]
  ('J703939825110',  99,  98,  91,  86,  94, 'Mild verbal bias'),  -- Prosper EZENWA
  ('C703939825079', 112, 116, 113, 107, 112, 'No bias'),  -- Ifechukwu UGWU
  ('R703939826025', 101,  95,  95,  92,  96, 'No bias'),  -- Sheila Aneke  [sheet id "New34"]
  ('W703939826020', 105, 102, 100,  84,  98, 'Moderate verbal bias'),  -- Ikemsinachi EZE  [sheet id "New9"]
  ('E703939822170', 112, 121,  98,  89, 105, 'Moderate verbal bias'),  -- Splendid NESTOR-EZEME  [sheet id "E703939822170-W1"]
  ('U703939822171', 114, 115, 105,  95, 107, 'Moderate verbal bias'),  -- Treasure NESTOR-EZEME  [sheet id "NEW 2026"]
  ('Z703939826003',  90, 107, 103,  83,  96, 'No bias'),  -- Onyekachukwu Nwachukwu  [sheet id "New35"]
  ('K703939825076', 104, 107,  99,  88, 100, 'Moderate verbal bias'),  -- Kennedy OKOYE
  ('A703939826013',  92, 113, 121, 109, 109, 'Mild spatial bias'),  -- Chukwuma ONUORAH
  ('N703939825078', 109, 102, 123, 119, 113, 'Mild spatial bias');  -- Ezinne UGWU

do $$
declare
  missing text;
begin
  select string_agg(distinct i.upn, ', ') into missing
  from cat4_sheet_scores i
  where not exists (select 1 from students s where s.upn = i.upn);
  if missing is not null then
    raise exception 'CAT4 score import: no student on roll with UPN(s): %', missing;
  end if;
end $$;

-- Students with no CAT4 result on record at all. Re-running is a no-op: the
-- NOT EXISTS stops a second dateless row appearing (the unique constraint on
-- (student_id, test_date) would not, since NULLs do not collide).
insert into cat4_results
  (student_id, test_date, level, verbal_sas, quantitative_sas, non_verbal_sas, spatial_sas, mean_sas, profile)
select s.student_id, null, null, i.verbal, i.quantitative, i.non_verbal, i.spatial, i.mean, i.profile
from cat4_sheet_scores i
join students s on s.upn = i.upn
where not exists (select 1 from cat4_results c where c.student_id = s.student_id);

-- Students whose sitting is already on record: keep the existing row and only
-- fill in the profile the old import had nowhere to put. Matching on all four
-- SAS scores is what keeps NWANZE's disputed row out of this.
update cat4_results c
set profile = i.profile
from cat4_sheet_scores i
join students s on s.upn = i.upn
where c.student_id = s.student_id
  and c.profile is null
  and c.verbal_sas = i.verbal
  and c.quantitative_sas = i.quantitative
  and c.non_verbal_sas = i.non_verbal
  and c.spatial_sas = i.spatial;

commit;
