-- Migration 255: parents see only children who are still at the school.
--
-- Why: leavers' parents were linked in Sept 2026 (681 student_parent rows
-- from the SIMS leavers' contacts export), and the principal decided that
-- once a child has left, their parents should see nothing of them in the
-- portal — not their results, documents, fees or anything else. The links
-- stay in student_parent as a record; only what parents can read changes.
--
-- Every parent read policy (students, results, attendance, behaviour,
-- documents and their storage objects, invoices, payments, target grades,
-- transcripts, CAT4/NGRT, Other Half choices) works by joining
-- student_parent, and those joins run under the parent's own RLS. So the
-- rule is applied once, at the link: parent_read_own_links now shows a
-- parent only the links to children whose status is 'active', and all of
-- those policies follow. It can't query students directly (students' parent
-- policy queries student_parent, which would recurse), so it goes through
-- my_current_child_ids(), which identifies the caller through auth.uid().
--
-- Two SECURITY DEFINER helpers read student_parent without RLS and would
-- otherwise still let a leaver's parent in, so they use the same function:
-- can_view_student_tuckshop() (tuckshop purchases, pre-orders, balance) and
-- report_week_assessments(). A leaver's own student login is already locked
-- (migration 251), so the student branches are unchanged.
--
-- Staff who are also parents still see leavers through their staff access;
-- the portal pages filter those out themselves.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.my_current_child_ids()
returns setof integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select sp.student_id
  from profiles p
  join student_parent sp on sp.parent_id = p.parent_id
  join students s on s.student_id = sp.student_id
  where p.id = auth.uid()
    and s.status = 'active';
$$;

revoke execute on function public.my_current_child_ids() from public, anon;
grant execute on function public.my_current_child_ids() to authenticated;

drop policy if exists parent_read_own_links on public.student_parent;
create policy parent_read_own_links on public.student_parent
  for select
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.parent_id = student_parent.parent_id)
    and student_parent.student_id in (select my_current_child_ids())
  );

create or replace function public.can_view_student_tuckshop(p_student_id integer)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    user_has_staff_role(array['tuckshop', 'bursar', 'smt'])
    or exists (select 1 from profiles pr where pr.id = auth.uid() and pr.student_id = p_student_id)
    or p_student_id in (select my_current_child_ids());
$$;

create or replace function public.report_week_assessments(p_student_id integer, p_from date, p_to date)
returns table(subject_id integer, week_start_date date, enrolled boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    is_staff_or_admin()
    or exists (select 1 from profiles p where p.id = auth.uid() and p.student_id = p_student_id)
    or p_student_id in (select my_current_child_ids())
  ) then
    raise exception 'Not allowed to view this student''s report' using errcode = 'insufficient_privilege';
  end if;

  return query
  select distinct r.subject_id, r.week_start_date,
         exists (
           select 1 from student_class sc join classes c on c.class_id = sc.class_id
           where sc.student_id = p_student_id and c.subject_id = r.subject_id
         ) as enrolled
  from results r
  join students s on s.student_id = r.student_id
  where s.year_group = (select year_group from students where student_id = p_student_id)
    and r.week_start_date between p_from and p_to
    and not r.is_demo
  union
  select distinct c.subject_id, null::date, true
  from student_class sc
  join classes c on c.class_id = sc.class_id
  join subjects sub on sub.subject_id = c.subject_id
  where sc.student_id = p_student_id
    and sub.on_grade_report;
end;
$$;
