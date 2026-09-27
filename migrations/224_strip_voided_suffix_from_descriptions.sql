-- 224_strip_voided_suffix_from_descriptions.sql
--
-- An early version of void_event_on_upheld_appeal() appended
-- " (voided — appeal upheld)" to the description of every event whose appeal
-- was upheld. Since migration 196 a withdrawn event is marked by voided_at
-- instead, and since PR 206 the student log and /appeals show "Withdrawn on
-- appeal" beside it, so the suffix only repeats that inside the teacher's
-- own words. The principal asked for it to be removed.
--
-- Six events carried it when this was written, all already voided. Only the
-- suffix (and any spaces before it) is removed; the rest of the description
-- is left as the teacher wrote it. The change is recorded in change_history.

update public.behaviour_events
set description = regexp_replace(description, '\s*\(voided — appeal upheld\)\s*$', '')
where description ~ '\(voided — appeal upheld\)\s*$';
