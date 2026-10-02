-- 320_unallocated_students.sql
--
-- Unallocated Students: one list, under Pastoral (/pastoral/unallocated), of
-- active students who are missing a boarding house, a boarding room, or a
-- lesson somewhere in their week. Asked for by the principal, 2 Oct 2026.
--
-- When this was written 2 of 278 active students had no boarding house, 13
-- had no room, and 43 Year 7s weren't in either Evening Prep group, so their
-- EP slot was empty every night.
--
-- What counts as a timetable gap. A period on a day is only expected of a
-- student if at least one other active student in the same year group has
-- a lesson then (or, for The Other Half, the current OH term has an active
-- activity open to that year on that day). So Year 12's free afternoons,
-- Fridays with no OH and so on aren't reported; an empty slot their year
-- mates are all filling is. A slot is filled by a lesson of any class the
-- student is in (timetable_slots, which includes single lessons with their
-- own teacher) or, for OH, by a choice in the current OH term
-- (other_half_choices; OH never goes through classes, migration 156).
--
-- SECURITY DEFINER so the list can be read in one call, gated on the page
-- itself with has_resource_access(), like upcoming_birthdays() (213). It
-- returns names, year, form, house and room only.

create or replace function public.unallocated_students()
returns table (
  student_id integer,
  first_name text,
  last_name text,
  year_group integer,
  form_class text,
  boarding_house text,
  boarding_room_number text,
  no_house boolean,
  no_room boolean,
  timetable_gaps text[]      -- e.g. {'Mon EP','Tue OH'}, in week order
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with s as (
    select st.* from students st
    where st.status = 'active' and not st.is_demo
      and has_resource_access('/pastoral/unallocated')
  ),
  lesson as (
    select distinct sc.student_id, ts.day_of_week, ts.period_number
    from student_class sc
    join timetable_slots ts on ts.class_id = sc.class_id
    where not ts.is_demo
  ),
  oh_choice as (
    select distinct c.student_id, c.day_of_week, other_half_period() as period_number
    from other_half_choices c
    where c.term_id = current_other_half_term()
  ),
  filled as (
    select * from lesson union select * from oh_choice
  ),
  expected as (
    select distinct s.year_group, l.day_of_week, l.period_number
    from lesson l join s on s.student_id = l.student_id
    union
    select distinct yg, a.day_of_week, other_half_period()
    from other_half_activities a, unnest(a.year_groups) yg
    where a.term_id = current_other_half_term() and a.is_active
  ),
  gaps as (
    select s.student_id,
           array_agg(e.day_of_week || ' ' || p.short_label
                     order by array_position(array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], e.day_of_week),
                              e.period_number) as timetable_gaps
    from s
    join expected e on e.year_group = s.year_group
    join periods p on p.period_number = e.period_number
    where not exists (
      select 1 from filled f
      where f.student_id = s.student_id
        and f.day_of_week = e.day_of_week
        and f.period_number = e.period_number
    )
    group by s.student_id
  )
  select s.student_id, s.first_name, s.last_name, s.year_group, s.form_class,
         s.boarding_house, s.boarding_room_number,
         coalesce(trim(s.boarding_house), '') = '',
         coalesce(trim(s.boarding_room_number), '') = '',
         coalesce(g.timetable_gaps, '{}')
  from s
  left join gaps g on g.student_id = s.student_id
  where coalesce(trim(s.boarding_house), '') = ''
     or coalesce(trim(s.boarding_room_number), '') = ''
     or g.timetable_gaps is not null
  order by s.year_group, s.last_name, s.first_name;
$$;

comment on function public.unallocated_students() is
  'Active students with no boarding house, no boarding room, or an empty slot in a period their year group '
  'otherwise has (lessons, Evening Prep, The Other Half). For /pastoral/unallocated.';

revoke all on function public.unallocated_students() from public, anon;
grant execute on function public.unallocated_students() to authenticated;

-- The Pastoral page: the same people as Birthdays and Mentor Groups.

insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/unallocated', 'Unallocated Students', 'Pastoral', 22)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select r, '/pastoral/unallocated'
from unnest(array['admin', 'smt', 'pastoral', 'houseparent', 'head_of_boarding', 'school_office']) as r
on conflict do nothing;
