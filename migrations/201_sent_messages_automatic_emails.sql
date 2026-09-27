-- 201_sent_messages_automatic_emails.sql
--
-- /comms/history ("Sent Messages") only listed messages written on
-- /comms/compose, so none of the emails Formwork sends by itself - parent
-- welcome emails, behaviour alerts, detention set/reminder/cancelled - showed
-- there, and staff reasonably read that as "nothing was sent". The page now
-- lists email_outbox too, for the same staff who can open it (SMT, Pastoral,
-- School Office, and admins).
--
-- email_outbox.payload holds each email's full body, and the parent welcome
-- emails carry the parent's initial login password in it. So the wider read
-- policy comes with column-level grants: client roles can read who an email
-- went to, its subject and its delivery state, never the body or the
-- request bookkeeping. Nothing in the app reads those columns (the welcome
-- email page only counts rows and reads recipient/last_error); the sender
-- (process_email_outbox, security definer) is unaffected. Admins lose client
-- read of payload as well, which nothing used.

revoke select on public.email_outbox from authenticated;
grant select (email_id, recipient, subject, status, attempts, last_error, created_at, sent_at)
  on public.email_outbox to authenticated;

create policy staff_comms_read_email_outbox on public.email_outbox
  for select to authenticated
  using (user_has_staff_role(array['smt', 'pastoral', 'school_office']));

-- email_outbox still carried Supabase's old blanket grants: every privilege
-- for anon, and insert/update/delete/truncate for authenticated. RLS stopped
-- them (no policy allows them), but only reads are meant to reach the client,
-- and anon nothing at all (see CLAUDE.md on explicit per-table grants).
revoke all on public.email_outbox from anon;
revoke insert, update, delete, truncate, references, trigger on public.email_outbox from authenticated;
