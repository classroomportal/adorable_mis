-- Migration 271: don't count "Other" contacts when finding siblings.
--
-- Why: the principal (principal@) and the college secretary (cs@) are
-- linked in student_parent to students they keep an eye on through the
-- parent portal, as a parent would. Through those links, children from
-- different families showed as each other's siblings on Core Data. The
-- principal's rule (30 Sept 2026): such records have their relationship
-- set to "Other", and a parent whose relationship is Other doesn't make
-- the children linked to them siblings. The links themselves are
-- unchanged, so portal access is not affected.
--
-- relationship_type is free text on parents; the match ignores case and
-- surrounding spaces. Otherwise the function is as in migration 268.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.student_siblings(p_student_id integer)
returns table (student_id integer, first_name text, last_name text, year_group integer, form_class text, status text, leaving_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.student_id, s.first_name, s.last_name, s.year_group, s.form_class, s.status::text, s.leaving_date
  from students s
  where public.is_staff_or_admin()
    and s.student_id <> p_student_id
    and (
      exists (
        select 1
        from student_parent mine
        join student_parent theirs on theirs.parent_id = mine.parent_id
        join parents p on p.parent_id = mine.parent_id
        where mine.student_id = p_student_id
          and theirs.student_id = s.student_id
          and lower(trim(coalesce(p.relationship_type, ''))) <> 'other'
      )
      or s.family_id = (select me.family_id from students me where me.student_id = p_student_id)
    )
  order by (s.status = 'active') desc, s.year_group desc, s.last_name, s.first_name;
$$;

revoke execute on function public.student_siblings(integer) from public, anon;
grant execute on function public.student_siblings(integer) to authenticated;
