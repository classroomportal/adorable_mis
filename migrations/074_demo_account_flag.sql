-- Migration 074: is_demo_account flag + helper function
-- First step of the staff_demo training-login feature: a shared SMT login whose
-- entries are fake and get wiped nightly, isolated from real data so neither side
-- ever sees the other's rows. This just adds the "who is the demo account" marker,
-- shaped exactly like the existing is_admin() pattern — a flag on profiles, not a
-- hardcoded staff_id, so it survives the account ever being re-provisioned.

alter table profiles add column if not exists is_demo_account boolean not null default false;

create or replace function is_demo_account() returns boolean as $$
  select exists (select 1 from profiles where id = auth.uid() and is_demo_account = true);
$$ language sql security definer stable;
