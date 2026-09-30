-- Migration 272: a parent's relationship is recorded for each child they are
-- linked to, not once per parent.
--
-- Why: cs@ (Uju MBA) is Daniel MBA's mother, and is also linked to other
-- students she keeps an eye on through the parent portal, as a parent
-- would. parents.relationship_type holds one value per person, so she could
-- be either "Mother" or "Other", never both, and migration 271 (skip
-- "Other" parents when finding siblings) couldn't tell Daniel's real
-- family from the children she only monitors. The principal's rule
-- (30 Sept 2026): cs@ is recorded as Mother for Daniel MBA only, and as
-- Other for everyone else she is linked to; links marked Other never make
-- children siblings.
--
-- What:
--   * student_parent.relationship: the relationship for this parent and this
--     child. Filled from parents.relationship_type for every existing link;
--     pages now show and edit this, falling back to the parent's own value
--     where a link has none.
--   * cs@'s links: Mother for Daniel MBA, Other for the rest. principal@'s
--     parent record was already Other, so its links are Other already.
--   * student_siblings(): two children are siblings through a parent only
--     when neither of their links to that parent is Other.
--
-- parents.relationship_type stays as the value used for a link that has
-- none of its own. Changes to student_parent are already logged in
-- change_history under parent_links (migration 218).

set local formwork.change_note = 'Principal (direct)';

alter table public.student_parent add column if not exists relationship text;

update public.student_parent sp
set relationship = p.relationship_type
from public.parents p
where p.parent_id = sp.parent_id
  and sp.relationship is null
  and p.relationship_type is not null;

-- cs@: Daniel MBA's mother; Other for everyone else she is linked to.
update public.student_parent sp
set relationship = case
    when s.first_name = 'Daniel' and s.last_name = 'MBA' then 'Mother'
    else 'Other'
  end
from public.parents p, public.students s
where p.parent_id = sp.parent_id
  and s.student_id = sp.student_id
  and lower(p.email) = 'cs@abc.sch.ng';

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
          and lower(trim(coalesce(mine.relationship, p.relationship_type, ''))) <> 'other'
          and lower(trim(coalesce(theirs.relationship, p.relationship_type, ''))) <> 'other'
      )
      or s.family_id = (select me.family_id from students me where me.student_id = p_student_id)
    )
  order by (s.status = 'active') desc, s.year_group desc, s.last_name, s.first_name;
$$;

revoke execute on function public.student_siblings(integer) from public, anon;
grant execute on function public.student_siblings(integer) to authenticated;
