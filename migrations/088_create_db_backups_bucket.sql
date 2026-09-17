-- Migration 088: private Storage bucket for nightly database backups
--
-- The Supabase org (kblfaysblwuwqiyfpxvq) is on the Free plan, which
-- includes no automatic database backups at all — not even a baseline
-- daily one, let alone PITR (that's Pro-and-up). Until/unless the org is
-- upgraded, .github/workflows/nightly-backup.yml does a nightly logical
-- dump (schema + data, via the Supabase CLI) and uploads it here as the
-- only safety net this database currently has.
--
-- The bucket is private (public = false) and no storage.objects policies
-- are added for anon/authenticated, so only the service-role key the
-- workflow uses (which bypasses RLS) can read, write, or prune backups.

insert into storage.buckets (id, name, public)
values ('db-backups', 'db-backups', false)
on conflict (id) do nothing;
