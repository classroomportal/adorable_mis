-- Migration 268: list leavers among a student's siblings too.
--
-- Why: migration 267 listed only siblings still at the school. The principal
-- asked (30 Sept 2026) for leavers to be shown as well, so staff can see
-- the whole family. This is staff-only data: the parents-see-only-current-
-- children rule (migration 255) is about the parent portal and is unchanged.
-- The function now returns each sibling's status and leaving date so the
-- page can mark leavers, and lists current students first.
--
-- The return type changes, so the function is dropped and recreated.

set local formwork.change_note = 'Principal (direct)';

drop function if exists public.student_siblings(integer);

create function public.student_siblings(p_student_id integer)
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
        where mine.student_id = p_student_id
          and theirs.student_id = s.student_id
      )
      or s.family_id = (select me.family_id from students me where me.student_id = p_student_id)
    )
  order by (s.status = 'active') desc, s.year_group desc, s.last_name, s.first_name;
$$;

revoke execute on function public.student_siblings(integer) from public, anon;
grant execute on function public.student_siblings(integer) to authenticated;
