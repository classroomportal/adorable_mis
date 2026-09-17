-- Migration 092: behaviour_events writes weren't actually scoped to staff
--
-- staff_write_behaviour and staff_update_behaviour only checked
-- auth.role() = 'authenticated' — not is_staff_or_admin() like
-- staff_read_behaviour already does. Any logged-in account (a student's own
-- login, a parent's) could insert a negative behaviour_events row, which
-- trg_notify_pastoral_on_negative_behaviour (see sql/CURRENT_SCHEMA.md's
-- intro — the trigger that once emailed real staff during demo seeding)
-- fires on unconditionally, sending a real email. With Resend's daily send
-- quota already tight, that's a way for anyone logged in to trigger email
-- sends, not just staff. Ties the write policies to is_staff_or_admin(),
-- matching the read policy.

drop policy "staff_write_behaviour" on behaviour_events;
create policy "staff_write_behaviour" on behaviour_events for insert with check (
  is_staff_or_admin() and is_demo = is_demo_account()
);

drop policy "staff_update_behaviour" on behaviour_events;
create policy "staff_update_behaviour" on behaviour_events for update using (
  is_staff_or_admin() and is_demo = is_demo_account()
);
