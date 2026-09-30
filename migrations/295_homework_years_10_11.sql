-- Migration 295: homework opens to every Year 10 and 11 teaching group.
--
-- Why: after the pilot on 10_1/Ma and 11_1/Ma, the principal (30 Sept 2026)
-- asked to open homework to all Year 10 and 11 students and the teachers of
-- their groups. Mentor groups are not included (the principal's words), and
-- neither are Prep groups: Prep is supervised study, not a taught subject,
-- so nobody sets homework "for" it.
--
--   1. Every Year 10 and 11 class except Mentor and Prep goes into
--      homework_classes, the switch can_set_homework() reads. Classes added
--      later (a new Nova-T import) are not switched on by themselves; an
--      admin adds them, as before.
--   2. The /homework page is granted to teacher, head_of_department and smt,
--      so teachers see the Homework link. The page is display only: which
--      classes someone can set homework for is still decided by
--      can_set_homework() (their own classes, lesson-level teachers, the HoD
--      and admin), so a Year 7–9 teacher sees an empty list.
--   3. my_homework_class_ids() returns the switched-on classes the caller
--      can set homework for in one call, instead of the page asking
--      can_set_homework() once per class (about 90 calls now).

set local formwork.change_note = 'Principal (direct)';

insert into public.homework_classes (class_id)
select c.class_id
from public.classes c
join public.subjects s on s.subject_id = c.subject_id
where c.year_group in (10, 11)
  and s.subject_name not in ('Mentor', 'Prep')
on conflict (class_id) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/homework' from unnest(array['teacher', 'head_of_department', 'smt']) r
where not exists (
  select 1 from public.role_permissions rp where rp.role_name = r and rp.resource_key = '/homework');

create or replace function public.my_homework_class_ids()
returns setof integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select hc.class_id from homework_classes hc where can_set_homework(hc.class_id);
$$;

revoke execute on function public.my_homework_class_ids() from public, anon;
grant execute on function public.my_homework_class_ids() to authenticated;
