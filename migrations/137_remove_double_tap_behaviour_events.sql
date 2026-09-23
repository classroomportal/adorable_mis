-- 137_remove_double_tap_behaviour_events.sql
-- Before the Add event button was disabled while saving, staff on a slow
-- connection re-tapped it and the same event was logged two or three times.
-- These 23 rows are the copies the principal approved removing — batches
-- inserted back-to-back with identical student/date/type/category/points/
-- description, keeping the first batch each time:
--
--   22 Sep  Disruption in class -2 (4 students, x3)   keep 697-700, remove 701-708
--   21 Sep  Representing the school +5 (12 students, x2)  keep 257-268, remove 269-280
--   21 Sep  Good Effort +2 (3 students, x2)             keep 218-220, remove 221-223
--
-- Left alone on purpose, pending someone who was there confirming: the
-- Punctuality +1 pairs (224-229 / 290-299, not back-to-back), Destiny EKEH's
-- earlier Good Effort (157), and David CHIEDOZIE's two blank entries (162, 165).
--
-- The 4 students in the Disruption batch appealed every copy with the same
-- text; behaviour_appeals.event_id cascades, so their duplicate appeals go too,
-- leaving one event and one pending appeal each (appeals 7, 15, 21, 10).
-- No detention references any of these rows.

delete from behaviour_events
where event_id in (
  701, 702, 703, 704, 705, 706, 707, 708,
  269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280,
  221, 222, 223
);
