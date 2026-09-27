-- 216_grade_history_page.sql
--
-- Registers /assessments/grade-history, the page that shows grade_history
-- (migration 215): every grade entered, changed or deleted and who did it.
-- Listed under Assessment.
--
-- Read-only over grade_history, whose RLS already limits reading to SMT,
-- assessment managers and admins, so no new tables, functions or grants.
-- The page is given to the same roles; granting it to anyone else at
-- /admin/permissions would show them the page but still no rows.

insert into public.resources (resource_key, label, section, sort_order)
values ('/assessments/grade-history', 'Grade History', 'Assessment', 67)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/assessments/grade-history'
from unnest(array['admin', 'smt', 'assessment_manager']) as r
on conflict do nothing;
