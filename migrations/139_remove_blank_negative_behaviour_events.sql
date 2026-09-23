-- 139_remove_blank_negative_behaviour_events.sql
-- On 22 Sep a negative event was saved for 12 students with no category, no
-- points and no description (the form didn't require either yet). Students saw
-- an unexplained negative and appealed it, which showed up on /appeals as a
-- second appeal next to their real Disruption appeal. The principal approved
-- removing them. behaviour_appeals.event_id cascades, so their 8 pending
-- appeals go too. The category/points/description guards mean a row that has
-- since been filled in is left alone.

delete from behaviour_events
where event_id between 709 and 720
  and type = 'negative'
  and category is null
  and points is null
  and description is null;
