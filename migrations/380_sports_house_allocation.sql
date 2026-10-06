-- Sports house allocation (/students/sports-houses), the principal 6 Oct 2026:
-- new admissions need a sports house, and whoever allocates them needs to
-- see how many boys and girls each house already has in each year group so
-- the houses stay balanced. On 6 Oct 2026 all 49 active Year 7s and 28 new
-- joiners in Years 8-10 had none.
--
-- No new data rules. The page writes students.sports_house through the
-- ordinary update, so the existing field permissions decide who can save:
-- check_student_field_edit() lets admins and the roles given sports_house
-- in student_field_permissions (the school office) change it, and refuses
-- everyone else. SMT and pastoral get the page to see the balance and the
-- list; their Save is refused unless they are given the field at
-- /admin/permissions.

insert into public.resources (resource_key, label, section, sort_order) values
  ('/students/sports-houses', 'Sports Houses', 'Students', 15)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('school_office', '/students/sports-houses'),
  ('smt', '/students/sports-houses'),
  ('pastoral', '/students/sports-houses')
on conflict do nothing;
