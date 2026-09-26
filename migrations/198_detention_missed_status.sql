-- 198_detention_missed_status.sql
--
-- /detention offers four statuses - scheduled, attended, missed, cancelled -
-- but detentions_status_check only ever allowed scheduled, attended and
-- cancelled. Choosing "missed" was rejected by the database, and because the
-- page ignored the error the dropdown just snapped back, so nobody could
-- record a student skipping detention. Allow it. Nothing else keys off
-- 'missed': handle_negative_behaviour() and the appeal trigger only create
-- 'scheduled' detentions and cancel 'scheduled' ones.

alter table public.detentions drop constraint detentions_status_check;
alter table public.detentions add constraint detentions_status_check
  check (status = any (array['scheduled'::text, 'attended'::text, 'missed'::text, 'cancelled'::text]));
