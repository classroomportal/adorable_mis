-- 136_one_appeal_per_behaviour_event.sql
-- Students on a slow connection tapped "Submit" on an appeal repeatedly, and
-- every tap inserted a row: event 717 had 27 identical pending appeals, event
-- 713 had 2. The portal only ever shows one appeal per event (once one exists
-- it shows its status instead of the Appeal button), so a behaviour event gets
-- at most one appeal. The portal now blocks the double tap too, but this
-- unique index is what actually guarantees it (two tabs, retries).
--
-- Cleanup first, approved by the principal: for each event keep the earliest
-- appeal and remove the later copies. Checked against live data before
-- applying — every duplicate was still pending with the same reason text as
-- the one kept, so nothing is lost. The status and reason guards mean a
-- reviewed or genuinely different appeal is never removed; if one existed,
-- the index creation below would fail loudly instead.

delete from behaviour_appeals a
using behaviour_appeals keep
where a.event_id = keep.event_id
  and a.appeal_id > keep.appeal_id
  and a.status = 'pending'
  and a.reason is not distinct from keep.reason;

create unique index if not exists behaviour_appeals_one_per_event
  on behaviour_appeals (event_id);
