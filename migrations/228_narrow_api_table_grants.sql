-- 228_narrow_api_table_grants.sql
--
-- Take the API roles' table grants down to what the app actually uses.
--
-- Until now every table and view in public carried the project's blanket
-- default grants: anon and authenticated each held SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES and TRIGGER on everything. RLS is enabled on
-- every table, so rows were still protected, but:
--   * TRUNCATE is not subject to RLS at all, so any signed-in user, or
--     anyone with the public anon key, held the right to empty a table;
--   * anon (not signed in) needs nothing: /login and /login/forgot only
--     call Supabase Auth, and every page that reads data waits for a
--     session;
--   * a verb with no policy is refused by RLS anyway, but CLAUDE.md's rule
--     is to grant only what the policies allow, so a missing policy fails
--     loudly instead of depending on RLS alone.
-- Migration 227 did this for email_reply_routes; this does the rest.
--
-- What changes:
--   1. anon loses every privilege on every table and view in public.
--   2. authenticated loses TRUNCATE, REFERENCES and TRIGGER everywhere.
--   3. authenticated loses each SELECT/INSERT/UPDATE/DELETE that no RLS
--      policy (for public or authenticated) allows; listed per table below.
--      Tables with no policies at all (behaviour_event_audit,
--      house_assignments, tuckshop_preorder_trim_backup_180) lose all four.
--   4. authenticated loses INSERT/UPDATE/DELETE on views (nothing writes
--      through a view); SELECT on views is unchanged.
--   5. New tables and views stop getting blanket grants: the default
--      privileges for postgres (the owner of everything in public) no
--      longer grant anything on tables to anon or authenticated. This is
--      what Supabase itself does from 30 Oct 2026, and CLAUDE.md already
--      requires every new table's migration to grant its own verbs; 226
--      showed what happens otherwise. Function and sequence defaults are
--      not touched.
--
-- Checked before applying (27 Sep 2026):
--   * Every write in app/ and lib/ to a table in step 3 uses a verb that
--     table keeps (attendance upserts keep INSERT+UPDATE; detentions,
--     register_alerts, behaviour_appeals updates keep UPDATE; results and
--     report comment upserts keep INSERT+UPDATE). Nothing upserts into a
--     table that loses UPDATE.
--   * No SECURITY INVOKER function or trigger inserts, updates or deletes
--     any table in step 3; the writes to them all run as SECURITY DEFINER.
--   * Server routes (app/**/route.js) don't query tables.
-- Service_role, postgres and SECURITY DEFINER functions are unaffected.

set local formwork.change_note = 'Principal (direct)';

-- 1. Nothing for anon.
revoke all on all tables in schema public from anon;

-- 2. Never needed by the app, and TRUNCATE bypasses RLS.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- 3. Verbs no policy allows.
revoke delete                           on public.attendance                        from authenticated;
revoke delete                           on public.behaviour_appeals                 from authenticated;
revoke select, insert, update, delete   on public.behaviour_event_audit             from authenticated;
revoke update                           on public.behaviour_photos                  from authenticated;
revoke insert, delete                   on public.detentions                        from authenticated;
revoke update, delete                   on public.fee_charge_batches                from authenticated;
revoke delete                           on public.fee_items                         from authenticated;
revoke update, delete                   on public.fee_payments                      from authenticated;
revoke insert, update, delete           on public.fee_terms                         from authenticated;
revoke select, insert, update, delete   on public.house_assignments                 from authenticated;
revoke update                           on public.invoice_line_items                from authenticated;
revoke insert, update, delete           on public.message_recipients                from authenticated;
revoke insert, update, delete           on public.messages                          from authenticated;
revoke insert, update, delete           on public.parent_welcome_sends              from authenticated;
revoke insert, update, delete           on public.periods                           from authenticated;
revoke insert, update, delete           on public.profiles                          from authenticated;
revoke insert, delete                   on public.register_alerts                   from authenticated;
revoke delete                           on public.report_pastoral_comments          from authenticated;
revoke delete                           on public.report_subject_comments           from authenticated;
revoke delete                           on public.results                           from authenticated;
revoke update, delete                   on public.student_invoices                  from authenticated;
revoke insert, update, delete           on public.system_backup_mode                from authenticated;
revoke insert, update, delete           on public.tuckshop_preorder_items           from authenticated;
revoke select, insert, update, delete   on public.tuckshop_preorder_trim_backup_180 from authenticated;
revoke insert, update, delete           on public.tuckshop_preorders                from authenticated;

-- 4. Views are read-only to the app.
revoke insert, update, delete on
  public.attendance_today, public.message_read_status, public.other_half_timetable,
  public.registers_not_done, public.school_day, public.student_growth_record,
  public.student_summary, public.target_grade_gaps
from authenticated;

-- 5. No more blanket grants on new tables.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
