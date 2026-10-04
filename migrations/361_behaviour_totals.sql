-- ============================================
-- Migration 361: Behaviour Totals (running positives and negatives)
--
-- Why (the principal, 4 Oct 2026): "a running total of positives and
-- negatives - mentors could see both for their class and by students. SMT
-- could see an average score per group, adding and subtracting positive and
-- negatives and dividing by number of students. The data sheet would come on
-- the pastoral tile."
--
-- How:
--  * behaviour_totals(from, to) gives one row per active student: their
--    mentor group (the class in the 'Mentor' curriculum block, the same
--    relationship my_mentee_ids() uses), positive and negative points and
--    event counts between the two dates. Voided events are left out; an
--    event returned to its teacher counts at the 0 points it now carries.
--    Negative points come back as stored (negative), so net = positive +
--    negative. A group's average is worked out on the page as net points
--    divided by the group's active students, including those with no events.
--  * SECURITY INVOKER: it reads behaviour_events, students and classes under
--    the caller's own policies, so it shows nobody anything they couldn't
--    already read (every staff role can view behaviour events). The page
--    narrows a mentor to their own group; that is display only.
--  * Page /pastoral/behaviour-totals on the Pastoral card, granted to
--    mentor, pastoral, head_of_boarding and smt (admins see every page).
-- ============================================

set local formwork.change_note = 'Principal (direct)';

insert into public.resources (resource_key, label, section, sort_order)
values ('/pastoral/behaviour-totals', 'Behaviour Totals', 'Pastoral', 24)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('mentor', '/pastoral/behaviour-totals'),
  ('pastoral', '/pastoral/behaviour-totals'),
  ('head_of_boarding', '/pastoral/behaviour-totals'),
  ('smt', '/pastoral/behaviour-totals')
on conflict do nothing;

create or replace function public.behaviour_totals(p_from date, p_to date)
returns table (
  student_id integer, first_name text, last_name text, preferred_name text,
  year_group integer, mentor_class_id integer, mentor_class_code text,
  mentor_staff_id integer, positive_points integer, negative_points integer,
  net_points integer, positive_count integer, negative_count integer)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  with mentor as (
    select distinct on (sc.student_id)
      sc.student_id, c.class_id, c.class_code, c.staff_id
    from student_class sc
    join classes c on c.class_id = sc.class_id
    join curriculum_blocks b on b.block_id = c.block_id and b.block_name = 'Mentor'
    order by sc.student_id, c.class_code
  ),
  ev as (
    select be.student_id,
      coalesce(sum(be.points) filter (where be.type = 'positive'), 0)::integer as pos_pts,
      coalesce(sum(be.points) filter (where be.type = 'negative'), 0)::integer as neg_pts,
      (count(*) filter (where be.type = 'positive'))::integer as pos_n,
      (count(*) filter (where be.type = 'negative'))::integer as neg_n
    from behaviour_events be
    where be.voided_at is null
      and be.event_date between p_from and p_to
    group by be.student_id
  )
  select s.student_id, s.first_name, s.last_name, s.preferred_name, s.year_group,
    m.class_id, m.class_code, m.staff_id,
    coalesce(ev.pos_pts, 0), coalesce(ev.neg_pts, 0),
    coalesce(ev.pos_pts, 0) + coalesce(ev.neg_pts, 0),
    coalesce(ev.pos_n, 0), coalesce(ev.neg_n, 0)
  from students s
  left join mentor m on m.student_id = s.student_id
  left join ev on ev.student_id = s.student_id
  where s.status = 'active';
$$;

revoke execute on function public.behaviour_totals(date, date) from public, anon;
grant execute on function public.behaviour_totals(date, date) to authenticated;
