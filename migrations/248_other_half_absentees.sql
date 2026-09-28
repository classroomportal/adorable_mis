-- Migration 248: Other Half absentees page for the coordinator.
--
-- Why: on any Other Half day the coordinator has to go and collect every
-- student who isn't where they should be. Until now the only view was one
-- register at a time (/other-half/register), so building that list meant
-- opening every activity in turn. /other-half/absentees puts the whole day
-- on one page: everyone marked absent in an OH register (with whether the
-- earlier registers that day had them in school, so the ones still on site
-- come first), everyone on an activity whose register hasn't marked them yet,
-- and everyone with no activity chosen for the day.
--
-- It reads only what staff can already read (attendance, other_half_* and
-- students are readable by any member of staff), so no new function or
-- policy is needed: this only adds the page to the permissions list, for the
-- same people who run the programme — the coordinator and SMT. Admins get it
-- through has_resource_access() as usual.

set local formwork.change_note = 'Principal (direct)';

insert into resources (resource_key, label, section, sort_order) values
  ('/other-half/absentees', 'Absentees', 'Other Half', 63)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('smt',        '/other-half/absentees'),
  ('other_half', '/other-half/absentees')
on conflict do nothing;
