-- 142_remove_simon_ogbonna_appeal.sql
-- Simon OGBONNA's appeal (21) against the 22 Sep Disruption in class -2
-- (event 699) arose from that event being saved three times by repeated
-- taps (copies removed in migration 137). The principal asked for the appeal
-- to be removed. The event itself, and its -2, are unchanged.

delete from behaviour_appeals
where appeal_id = 21
  and event_id = 699
  and status = 'pending';
