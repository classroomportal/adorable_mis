-- 118_nova_t_subject_codes_for_reimport.sql
-- Makes migration 117's fix survive the next Nova-T import.
--
-- 117 repointed the Literature groups (10LI/El, 11LI/El, 12a/El1) off the
-- invented "Electronics" subject and onto "English Lit". That corrected the
-- classes but not the thing that decides them on re-import.
--
-- /admin/import-classes resolves a Nova-T row's subject purely through
-- subjects.subject_code: it takes the group code's suffix, strips the set
-- number ("10LI/El" -> "El", "12a/El1" -> "El"), and looks that up. The code
-- "El" was still sitting on Electronics, so the very next import of the
-- timetable would have matched El -> Electronics and offered the three
-- Literature groups back as a subject change -- silently undoing 117.
--
-- El is the school's own Nova-T code for Literature, so it belongs to
-- English Lit. subject_code is UNIQUE, so Electronics has to release it
-- first.

update subjects set subject_code = null where subject_code = 'El';

update subjects set subject_code = 'El' where subject_name = 'English Lit';

-- Same class of bug, found by replaying the importer's resolution over every
-- existing class: Personal Study was stored as "PS" but the group codes are
-- 12a/Ps1 and 12a/Ps2, which reduce to "Ps". The lookup is a JS Map keyed on
-- the raw string, so "Ps" never matched -- those two classes have been
-- landing in the importer's "subject code not found" list and keeping
-- whatever subject they already had. Store the code as the export actually
-- writes it.

update subjects set subject_code = 'Ps' where subject_name = 'Personal Study' and subject_code = 'PS';

-- After this, replaying the importer's resolution over every class in the
-- database (suffix -> strip trailing digits -> subjects.subject_code) agrees
-- with the subject each class already has, for all of them. A re-import of
-- the current timetable is a no-op on subjects rather than a regression.
--
-- Note for whoever adds a subject next: subject_code is not editable from
-- /admin/subject-settings, only from SQL, and the importer's match is
-- case-sensitive and exact. It must be the code as Nova-T writes it in the
-- group name, with any set number stripped -- "Ps", not "PS".
