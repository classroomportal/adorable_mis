-- 144_good_work_category_for_blank_events.sql
-- 93 positive events from 21-22 Sep had no category, no points and no
-- comment: on the old form, a second tap after a slow save re-submitted with
-- the category cleared and the whole group re-ticked (see migrations 137/139).
-- The principal chose to keep them as a 1-point award under a new "Good work"
-- category, which is also available to staff from now on (editable in
-- /admin/lookups).
--
-- Only the fully empty events are touched. 26 other category-less events that
-- do have points and a comment are left as they are.
-- Run without a logged-in user, so migration 140's points trigger leaves the
-- update alone; the points are set from the category here explicitly.

insert into behaviour_categories (name, type, default_points)
select 'Good work', 'positive', 1
where not exists (
  select 1 from behaviour_categories where name = 'Good work' and type = 'positive'
);

update behaviour_events e
set category = c.name,
    points = c.default_points
from behaviour_categories c
where c.name = 'Good work'
  and c.type = 'positive'
  and e.type = 'positive'
  and e.category is null
  and e.points is null
  and e.description is null
  and e.event_date between '2026-09-21' and '2026-09-22';
