-- Migration 300: student groups, stage 4 (the student and parent portals).
--
-- Why (the principal, 30 Sept 2026, docs/student-groups-design.md): staff
-- always see which groups a student is in; students and parents see only the
-- groups marked to be shown to them (Prefects, Debate Club). Stages 1–3
-- (migrations 284, 285, 287) left students and parents with no access at all.
--
-- Now one read function, portal_student_groups(student_id), used by the
-- Groups tile on /portal and on the parent portal. There are deliberately no
-- new select policies on the group tables: a policy on student_group_members
-- would let a student list everyone else in the group, and the design only
-- promises "which groups am I in". The function returns the group's name,
-- description, kind and the staff who run it, never its other members and
-- never marks (the principal: students and parents don't see group marks).
--
-- Who sees what (checked through auth.uid(); the student_id passed in is
-- only a claim):
--   * the student themself: groups shown to students or to students and
--     parents;
--   * a parent of a current child (my_current_child_ids(), migration 255, so
--     never a leaver): groups shown to students and parents only;
--   * staff: the parent's view, for staff previewing the portal as a parent
--     (/parents/view-as) and staff who are also parents. Staff can already
--     read every group, so this shows them nothing new.
-- Always: only active students, only groups that aren't archived, only the
-- current academic year (last year's prefects aren't this year's), and never
-- a group built from a rule (already staff-only by the
-- student_groups_rule_staff_only check; repeated here so a future change to
-- that check can't put a behaviour list on a portal).

create or replace function public.portal_student_groups(p_student_id integer)
returns table(group_id bigint, name text, description text, kind text, run_by text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with viewer as (
    select case
      when p_student_id = my_student_id() then 'student'
      when p_student_id in (select my_current_child_ids()) then 'parent'
      when is_staff_or_admin() then 'parent'
    end as as_who
  )
  select g.group_id, g.name, g.description, g.kind,
         (select string_agg(nullif(btrim(coalesce(st.first_name, '') || ' ' || coalesce(st.last_name, '')), ''),
                            ', ' order by st.last_name, st.first_name)
          from student_group_staff gs
          join staff st on st.staff_id = gs.staff_id
          where gs.group_id = g.group_id)
  from viewer v
  join student_group_members gm on gm.student_id = p_student_id
  join student_groups g on g.group_id = gm.group_id
  join students s on s.student_id = gm.student_id and s.status = 'active'
  join academic_years y on y.academic_year_id = g.academic_year_id and y.status = 'current'
  where v.as_who is not null
    and g.archived_at is null
    and g.rule_type is null
    and (g.visibility = 'students_and_parents'
         or (v.as_who = 'student' and g.visibility = 'students'))
  order by g.name;
$$;

revoke execute on function public.portal_student_groups(integer) from public, anon;
grant execute on function public.portal_student_groups(integer) to authenticated;
