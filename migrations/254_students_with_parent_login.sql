-- Migration 254: which students have a parent who can sign in.
--
-- Why: /reports/documents now uploads for students who have left as well as
-- current ones, and most leavers have no parent linked in Formwork yet (their
-- parents' records haven't been imported). A document published for such a
-- student is stored but no parent can see it, so the page warns about each
-- one before publishing. It needs to know, per student, whether any linked
-- parent has a login, but student_parent and profiles aren't readable by
-- everyone who can use that page (assessment managers, for example).
--
-- This returns only the yes/no answer (the IDs of the given students that do
-- have one), and only to someone who can open /reports/documents, checked
-- through auth.uid() by has_resource_access(). Nothing else about parents is
-- exposed.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.students_with_parent_login(p_student_ids integer[])
returns setof integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_resource_access('/reports/documents') then
    raise exception 'Not allowed';
  end if;
  return query
    select distinct sp.student_id
    from student_parent sp
    join profiles p on p.parent_id = sp.parent_id
    where sp.student_id = any(p_student_ids);
end;
$$;

revoke execute on function public.students_with_parent_login(integer[]) from public, anon;
grant execute on function public.students_with_parent_login(integer[]) to authenticated;
