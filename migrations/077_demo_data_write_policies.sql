-- Migration 077: demo-scope every write policy staff_demo can reach, and close a
-- read leak hiding in two FOR ALL policies from before this feature existed.
--
-- certificates_awarded's staff_write_certificates and target_grades's
-- assessment_write_target_grades are both FOR ALL policies, which — same as any
-- other command — also grants SELECT. Since 076 only replaced each table's
-- SELECT-specific policy, these two FOR ALL policies would still permissively
-- allow any staff/assessment-manager to see demo rows unfiltered (permissive RLS
-- policies for the same command OR together, so the more permissive one wins).
-- Splitting them into command-specific policies here removes that overlap so 076's
-- SELECT policy is the sole authority on reads for these two tables, while keeping
-- the exact same real-world write capability as before.

-- behaviour_events — INSERT/UPDATE were blanket auth.role()='authenticated' before
-- this feature; tightened here to also require demo-ness to match. The 075 trigger
-- sets is_demo on insert, so this isn't a behaviour change for real staff.
drop policy if exists "staff_write_behaviour" on behaviour_events;
create policy "staff_write_behaviour" on behaviour_events for insert with check (
  auth.role() = 'authenticated' and is_demo = is_demo_account()
);
drop policy if exists "staff_update_behaviour" on behaviour_events;
create policy "staff_update_behaviour" on behaviour_events for update using (
  auth.role() = 'authenticated' and is_demo = is_demo_account()
);

-- attendance — same pattern; the app's attendance insert is an upsert, but the
-- ON CONFLICT DO UPDATE path only ever touches existing rows whose is_demo was
-- already set correctly at their original insert, so it isn't re-derived here.
drop policy if exists "staff_write_attendance" on attendance;
create policy "staff_write_attendance" on attendance for insert with check (
  auth.role() = 'authenticated' and is_demo = is_demo_account()
);
drop policy if exists "staff_update_attendance" on attendance;
create policy "staff_update_attendance" on attendance for update using (
  auth.role() = 'authenticated' and is_demo = is_demo_account()
);

-- certificates_awarded — replaces the FOR ALL policy (see header) with the same
-- three commands split out, each demo-scoped.
drop policy if exists "staff_write_certificates" on certificates_awarded;
create policy "staff_insert_certificates" on certificates_awarded for insert with check (
  is_staff_or_admin() and is_demo = is_demo_account()
);
create policy "staff_update_certificates" on certificates_awarded for update using (
  is_staff_or_admin() and is_demo = is_demo_account()
);
create policy "staff_delete_certificates" on certificates_awarded for delete using (
  is_staff_or_admin() and is_demo = is_demo_account()
);

-- target_grades — replaces the FOR ALL policy (see header). No BEFORE INSERT
-- trigger is added here: staff_demo only holds 'smt', not 'assessment_manager',
-- so she can't write target grades even in demo mode, matching what a real
-- SMT-only staffer experiences today. Real assessment managers' writes are
-- unaffected (they never set is_demo, which defaults to false and matches
-- is_demo_account()=false for them).
drop policy if exists "assessment_write_target_grades" on target_grades;
create policy "assessment_insert_target_grades" on target_grades for insert with check (
  is_assessment_manager() and is_demo = is_demo_account()
);
create policy "assessment_update_target_grades" on target_grades for update using (
  is_assessment_manager() and is_demo = is_demo_account()
);
create policy "assessment_delete_target_grades" on target_grades for delete using (
  is_assessment_manager() and is_demo = is_demo_account()
);

-- behaviour_appeals — pastoral approve/reject, demo-scoped so staff_demo can only
-- action the pre-seeded demo appeal, and real pastoral/SMT staff can't action it.
drop policy if exists "pastoral_update_appeals" on behaviour_appeals;
create policy "pastoral_update_appeals" on behaviour_appeals for update using (
  is_pastoral_or_smt() and is_demo = is_demo_account()
);
