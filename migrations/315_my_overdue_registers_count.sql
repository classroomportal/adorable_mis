-- Migration 315: the staff timetable's overdue-register count, cheaply.
--
-- Why (the principal, 2 Oct 2026: Class Allocation by Block "taking a long
-- time to load"): the page itself is small, but at 08:00 the whole database
-- slowed down. Every request, even one-row lookups, took 20-90 seconds. The
-- biggest load was the staff timetable: every open copy reads
-- registers_not_done every minute to show "N of your registers are overdue".
-- The view runs as the caller (security_invoker), so each read re-plans a
-- union over timetable_slots, classes, staff, student_class, attendance and
-- the Other Half tables with every table's RLS policy inlined: about a second
-- of planning per call, 1.6 s on average, 17,700 calls, by far the largest
-- share of database time. At the start of the school day, with many teachers
-- signing in at once, that saturated the database for everyone.
--
-- my_overdue_registers_count() gives the same number for the caller only.
-- It is SECURITY DEFINER so the view's tables are read without the RLS checks
-- (and plpgsql keeps the plan between calls), but it identifies the caller
-- through auth.uid() -> profiles.staff_id, never a staff_id from the request,
-- and returns only a count of that person's own registers. Someone without a
-- staff record gets 0. The view and /pastoral/registers-not-done are unchanged.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.my_overdue_registers_count()
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_staff_id integer;
begin
  select p.staff_id into v_staff_id from profiles p where p.id = auth.uid();
  if v_staff_id is null then
    return 0;
  end if;
  -- staff_ids, not staff_id: an Other Half activity can have several staff,
  -- and its row belongs to all of them (migration 157).
  return (select count(*) from registers_not_done r where r.staff_ids @> array[v_staff_id]);
end;
$$;

revoke execute on function public.my_overdue_registers_count() from public, anon;
grant execute on function public.my_overdue_registers_count() to authenticated;
