-- Migration 113: two bugs caught by code review of migration 111/112, before merge.
--
-- 1. migration 112 gave school_office insert/update on `parents` but no
-- SELECT policy exists for school_office at all (only admin, own-parent,
-- and is_pastoral_or_smt() could read it) -- app/parents/page.js does a
-- plain unfiltered select, so school_office would see an empty table and
-- have nothing to click "edit" on. Add the missing read.
create policy "school_office_read_parents" on parents
  for select using (user_has_staff_role(array['school_office']));

-- 2. is_pastoral_or_smt() checks smt/houseparent but not the 'pastoral'
-- role itself -- a copy-paste-looking gap, since pastoral's own
-- description is "Manages behaviour appeals and detention" and this
-- function gates read access to behaviour_appeals, detentions, parents
-- (read_parents_pastoral) and student_parent (read_student_parent_pastoral).
-- migration 111 (this same PR) grants the bare 'pastoral' role the
-- '/appeals' tile (carried forward from migration 046, which already had
-- this grant) -- so a pastoral-only staffer now sees "Behaviour Appeals"
-- as an accessible tile and gets blocked by this exact function on
-- opening it. Widen it to include pastoral, matching every other place
-- pastoral's remit already includes appeals/detention.
create or replace function is_pastoral_or_smt()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select is_admin() or has_staff_role(array['smt','houseparent','pastoral']);
$$;
