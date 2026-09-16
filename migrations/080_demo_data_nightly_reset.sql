-- Migration 080: schedule reset_demo_data() to run nightly
-- Prerequisite: the pg_cron extension must be enabled on this Supabase project —
-- this can't be verified from outside the live database. If the schedule call
-- below errors with "function cron.schedule(...) does not exist", enable pg_cron
-- first via the Supabase dashboard's Database -> Extensions page, then re-run just
-- this file. Everything in 074-079 works independently of this file.

select cron.schedule(
  'reset-demo-data-nightly',
  '0 3 * * *',
  $$select reset_demo_data();$$
);
