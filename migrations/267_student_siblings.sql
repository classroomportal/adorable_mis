-- Migration 267: siblings on a student's Core Data, found through shared
-- parents.
--
-- Why: the principal asked (30 Sept 2026) for a student's Core Data to show
-- any brothers or sisters still at the school. The profile page already had
-- a Siblings tile, but it matched on students.family_id, which is empty for
-- every student, so the tile never appeared. Families are really recorded
-- through student_parent: two students linked to the same parent are
-- siblings (159 of the 277 active students have one this way).
--
-- student_parent is readable only by admin, pastoral/SMT and the school
-- office, and parents' details should stay that way, so a query from the
-- page would hide siblings from everyone else. This function returns only
-- the siblings themselves (name, year, form), which any member of staff can
-- already read in students, and no parent details. Only students still at
-- the school (status = 'active') are listed. family_id is still matched too,
-- in case it is ever filled in.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.student_siblings(p_student_id integer)
returns table (student_id integer, first_name text, last_name text, year_group integer, form_class text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.student_id, s.first_name, s.last_name, s.year_group, s.form_class
  from students s
  where public.is_staff_or_admin()
    and s.status = 'active'
    and s.student_id <> p_student_id
    and (
      exists (
        select 1
        from student_parent mine
        join student_parent theirs on theirs.parent_id = mine.parent_id
        where mine.student_id = p_student_id
          and theirs.student_id = s.student_id
      )
      or s.family_id = (select me.family_id from students me where me.student_id = p_student_id)
    )
  order by s.year_group desc, s.last_name, s.first_name;
$$;

revoke execute on function public.student_siblings(integer) from public, anon;
grant execute on function public.student_siblings(integer) to authenticated;
