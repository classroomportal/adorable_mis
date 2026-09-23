-- 143_behaviour_category_required.sql
-- Every behaviour event must have a category. The /behaviour form requires one
-- and migration 140's trigger refuses a missing category for logged-in users;
-- this constraint also covers anything else (SQL editor, service role).
--
-- Added NOT VALID: 93 old blank events from 21-22 Sep (double taps on the old
-- form — see migrations 137/139) still have no category and are left for the
-- principal to decide on. New rows, and any update to an existing row, must
-- satisfy it.
--
-- Also gives the two blank events that did carry a real comment ("Gave
-- accurate answer to question during English class", 142 and 143) the
-- Excellent work category and its points, as the principal asked.

update behaviour_events e
set category = c.name,
    points = c.default_points
from behaviour_categories c
where c.name = 'Excellent work'
  and c.type = 'positive'
  and e.event_id in (142, 143)
  and e.type = 'positive'
  and e.category is null;

alter table behaviour_events drop constraint if exists behaviour_events_category_required;
alter table behaviour_events
  add constraint behaviour_events_category_required
  check (category is not null and length(trim(category)) > 0) not valid;
