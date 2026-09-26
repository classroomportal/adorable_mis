-- 191_top_ten_page.sql
--
-- Registers /results/top-ten, a printable top 10 students for a result set
-- (by year, every year, or the whole school), ranked on each student's
-- average percentage across their subjects. Listed under Assessment.
--
-- Read-only over results, which staff can already read (staff_read_results),
-- so no new tables, functions or grants. Given to the people who run
-- assessment and the ones likely to print it for assemblies and follow-up:
-- SMT, heads of department and pastoral. Widen at /admin/permissions.

insert into public.resources (resource_key, label, section, sort_order)
values ('/results/top-ten', 'Top 10 Students', 'Assessment', 66)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/results/top-ten'
from unnest(array['admin', 'smt', 'assessment_manager', 'assessment_user', 'head_of_department', 'pastoral']) as r
on conflict do nothing;
