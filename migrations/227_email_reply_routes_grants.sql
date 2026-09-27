-- 227_email_reply_routes_grants.sql
--
-- Narrow the API grants on email_reply_routes to what migration 226 meant.
--
-- 226 granted authenticated SELECT and UPDATE, but the project's default
-- privileges (in force until Supabase's 30 Oct 2026 change) had already
-- given anon and authenticated every privilege on the new table: INSERT,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER as well. RLS blocks the inserts
-- and deletes (there are no policies for them), but TRUNCATE is not subject
-- to RLS at all. Only SMT and admins use the table, and only to read and
-- update it, so everything else is revoked.
--
-- Older tables created before the default changes (bell_times, for one)
-- carry the same blanket grants; that is a separate, wider clean-up.

set local formwork.change_note = 'Principal (direct)';

revoke all on public.email_reply_routes from anon;
revoke insert, delete, truncate, references, trigger on public.email_reply_routes from authenticated;
