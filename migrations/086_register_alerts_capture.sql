-- Migration 086: persist register-lateness alerts for SRO/HR follow-up
--
-- registers_not_done (a SECURITY DEFINER view, not created by any migration in
-- this repo) already computes, live, which classes are 15+ minutes into a period
-- with no register taken, dropping back out after 3 hours. register_alerts exists
-- to be the persisted, followed-up-able version of that — something SRO/HR can
-- review historically and mark resolved — but nothing has ever written to it.
--
-- capture_register_alerts() snapshots registers_not_done into register_alerts,
-- once per missed register per day (the NOT EXISTS guard makes repeat runs a
-- no-op), meant to be called on a schedule. is_demo is derived directly from
-- timetable_slots rather than from the view, since the view doesn't expose it.
--
-- NOTE: RLS below is scoped to is_admin() as a placeholder — I don't know the
-- actual staff_roles.role_name values used for SRO/HR in this school's setup.
-- Tell me those and I'll narrow this from admin-only to the right roles.

alter table register_alerts add column if not exists is_demo boolean not null default false;

create or replace function capture_register_alerts()
returns void
language plpgsql security definer as $$
begin
  insert into register_alerts (timetable_slot_id, staff_id, period_date, minutes_late, resolved, is_demo)
  select rnd.slot_id, rnd.staff_id, current_date, round(rnd.minutes_since_start), false, ts.is_demo
  from registers_not_done rnd
  join timetable_slots ts on ts.slot_id = rnd.slot_id
  where not exists (
    select 1 from register_alerts ra
    where ra.timetable_slot_id = rnd.slot_id and ra.period_date = current_date
  );
end;
$$;

select cron.schedule('capture-register-alerts', '*/15 * * * *', $$select capture_register_alerts();$$);

drop policy if exists "admin_read_register_alerts" on register_alerts;
create policy "admin_read_register_alerts" on register_alerts for select using (
  is_admin() and (is_demo = is_demo_account() or is_admin())
);

drop policy if exists "admin_update_register_alerts" on register_alerts;
create policy "admin_update_register_alerts" on register_alerts for update using (
  is_admin() and (is_demo = is_demo_account() or is_admin())
);
