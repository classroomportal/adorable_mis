-- Migration 365: adding and ending planned absences become ordinary ticks.
--
-- Why (the principal, 5 Oct 2026): "planned absences needs to be unlocked".
-- Migration 330 converted planned_absences to the tickable abilities but
-- padlocked add, edit and delete, because the app never writes the table
-- itself: add_planned_absence() and end_planned_absence() (migration 318) do,
-- and they checked the /attendance/planned-absences page instead of a tick.
--
-- After this:
--   * add  (Add planned absence) and edit (End planned absence, which also
--     cancels one that hasn't started) are ticks at /admin/permissions. The
--     two functions check has_ability('planned_absences', 'add' / 'edit')
--     instead of the page.
--   * The ticks start as today's access: every role with the Planned
--     Absences page (school office, attendance officer, pastoral, SMT as
--     seeded by 318), and admin (has_resource_access lets admins through).
--   * delete stays padlocked: planned absences are ended, never deleted, and
--     there is no way to delete one.
--   * The table still has no insert or update grant: writing goes only
--     through the two functions, which check the dates and code and write or
--     remove the register marks. The tick decides who may call them.
-- The page permission still decides who sees the page; seeing the list is the
-- existing 'view' tick (every role).

set local formwork.change_note = 'Principal (direct)';

delete from public.role_ability_locks
where table_name = 'planned_absences' and action in ('add', 'edit');

insert into public.role_abilities (role_name, table_name, action)
select r.role_name, 'planned_absences', a.action
from (select role_name from public.role_permissions
       where resource_key = '/attendance/planned-absences'
      union select 'admin') r
join public.roles ro on ro.role_name = r.role_name
cross join (values ('add'), ('edit')) a(action)
on conflict (role_name, table_name, action) do nothing;

create or replace function public.add_planned_absence(
  p_student_id integer,
  p_start date,
  p_end date,
  p_code text,
  p_notes text default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_clash planned_absences%rowtype;
  v_id bigint;
  v_added integer;
begin
  if not has_ability('planned_absences', 'add') then
    raise exception 'You are not allowed to add planned absences.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day must be on or after the first day.'
      using errcode = 'check_violation';
  end if;
  if p_end - p_start > 366 then
    raise exception 'A planned absence can be at most a year long.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from students s where s.student_id = p_student_id and s.status = 'active') then
    raise exception 'That student is not on roll.'
      using errcode = 'check_violation';
  end if;
  select ac.status into v_status from attendance_codes ac where ac.code = p_code;
  if v_status is distinct from 'authorized_absence' then
    raise exception 'Choose an authorised absence code (illness, appointment, holiday, visit, exclusion...).'
      using errcode = 'check_violation';
  end if;

  select * into v_clash from planned_absences pa
   where pa.student_id = p_student_id and pa.cancelled_at is null
     and pa.start_date <= p_end and pa.end_date >= p_start
   limit 1;
  if found then
    raise exception 'This student already has a planned absence from % to %. End or cancel it first.',
      to_char(v_clash.start_date, 'Dy DD Mon YYYY'), to_char(v_clash.end_date, 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  insert into planned_absences (student_id, start_date, end_date, code, notes, created_by_staff_id)
  values (p_student_id, p_start, p_end, p_code, nullif(btrim(p_notes), ''),
          (select p.staff_id from profiles p where p.id = auth.uid()))
  returning id into v_id;

  v_added := planned_absence_apply_days(v_id, p_start, p_end);
  return json_build_object('id', v_id, 'marks_added', v_added);
end;
$$;

revoke execute on function public.add_planned_absence(integer, date, date, text, text) from public, anon;
grant execute on function public.add_planned_absence(integer, date, date, text, text) to authenticated;

create or replace function public.end_planned_absence(p_id bigint, p_back_on date)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r planned_absences%rowtype;
  v_removed integer;
begin
  if not has_ability('planned_absences', 'edit') then
    raise exception 'You are not allowed to end planned absences.';
  end if;
  select * into r from planned_absences where id = p_id for update;
  if not found or r.cancelled_at is not null then
    raise exception 'That planned absence no longer exists or was already cancelled.';
  end if;
  if p_back_on is null then
    raise exception 'Choose the day the student is back.';
  end if;
  if p_back_on > r.end_date then
    raise exception 'That planned absence already ends on %.', to_char(r.end_date, 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  delete from attendance a where a.planned_absence_id = p_id and a.attend_date >= p_back_on;
  get diagnostics v_removed = row_count;

  if p_back_on <= r.start_date then
    update planned_absences set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
    return json_build_object('cancelled', true, 'marks_removed', v_removed);
  end if;

  update planned_absences set end_date = p_back_on - 1 where id = p_id;
  return json_build_object('cancelled', false, 'end_date', p_back_on - 1, 'marks_removed', v_removed);
end;
$$;

revoke execute on function public.end_planned_absence(bigint, date) from public, anon;
grant execute on function public.end_planned_absence(bigint, date) to authenticated;
