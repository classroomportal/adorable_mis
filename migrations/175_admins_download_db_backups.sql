-- Migration 175: let Formwork admins download database backups
--
-- WHY: the nightly backups in the private db-backups bucket could only be
-- fetched from the Supabase dashboard, by someone signed in to the Supabase
-- organisation. The principal asked (26 September 2026) for a download button
-- in Formwork itself, so an admin can take a copy before something risky
-- without dashboard access or a service-role key. They approved every
-- Formwork admin being able to do this, after trimming the admin role to
-- three accounts.
--
-- Migration 088 left the bucket with no storage.objects policies, so only the
-- service-role key could touch it. This adds exactly one: admins may read
-- (and so create signed download links for) objects in db-backups. Nothing
-- here lets anyone write, overwrite or delete a backup — that stays with the
-- workflow's service-role key, so a compromised admin session can take a copy
-- but cannot destroy the history.
--
-- These files hold every student's and staff member's personal data. The
-- admin role is the gate, which is why the policy checks is_admin() rather
-- than a resource permission: a page grant on /admin/backup must never be
-- enough to download the whole MIS.

drop policy if exists admins_read_db_backups on storage.objects;
create policy admins_read_db_backups on storage.objects
  for select to authenticated
  using (bucket_id = 'db-backups' and public.is_admin());
