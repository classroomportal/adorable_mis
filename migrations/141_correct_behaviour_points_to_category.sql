-- 141_correct_behaviour_points_to_category.sql
-- Before migration 140 locked points to the category, staff could type their
-- own number. These 10 events were saved with points that didn't match their
-- category; the principal asked for them to be brought in line:
--
--   114  Helping others  1 -> 3
--   147  Kindness        3 -> 2
--   643-650  Good Effort 1 -> 2  (8 students, 22 Sep, "Kept to class routines")
--
-- Voided events (points 0, from an upheld appeal) are excluded so a void is
-- never undone. Run without a logged-in user, so migration 140's trigger
-- leaves the update alone.

update behaviour_events e
set points = c.default_points
from behaviour_categories c
where c.name = e.category
  and c.type = e.type
  and e.event_id in (114, 147, 643, 644, 645, 646, 647, 648, 649, 650)
  and e.points is distinct from c.default_points
  and e.points <> 0;
