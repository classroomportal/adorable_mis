-- 232_rename_subject_overview_resource.sql
--
-- Renames the /results/subject-overview page to "Review Results" at
-- /admin/permissions.
--
-- The principal asked on 28 Sep 2026 for the page to be renamed, because
-- mentors weren't finding it as a way to review their students' grades. The
-- dashboard link and page heading were renamed in the app (PR #216). This
-- brings the label in the permissions list into line. The resource_key is
-- unchanged, so no role gains or loses the page.
--
-- Already applied to the live database through the Supabase connector on
-- 28 Sep 2026; this file records it.

set local formwork.change_note = 'Principal (direct)';

update public.resources
set label = 'Review Results'
where resource_key = '/results/subject-overview'
  and label = 'Subject Overview';
