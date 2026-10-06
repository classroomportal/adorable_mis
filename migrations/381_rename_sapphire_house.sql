-- The sports house "Saphire" was misspelt from the start; the principal asked
-- for "Sapphire" (6 Oct 2026). students.sports_house references
-- sports_houses.name with on update cascade, so renaming the house renames
-- it on every student (logged in change_history under students). Nothing
-- else stored the old spelling (checked across every text column).

update public.sports_houses set name = 'Sapphire' where name = 'Saphire';
