-- Migration 415: a C mark set by the office or the principal can only be
-- changed by the office or the principal.
--
-- Why (the principal, 9 Oct 2026): "When the office or myself set C absence
-- code - people still seem to be able to change it". Migration 389 locked
-- planned-absence marks to the office, but a C ("Other authorised absence")
-- typed straight onto a register by the office or the principal, or set at
-- Student Marks (390, which deliberately makes marks ordinary ones), was an
-- ordinary mark, and registers are open to all staff (330). Change History
-- shows teachers and houseparents saving over them: 8-9 Oct, about a dozen
-- office/principal C marks turned into /, N, L by the next register.
--
-- The rule:
--   * A mark is office-locked when its code is C and the person who saved it
--     (attendance.staff_id) holds school_office, attendance_officer, principal
--     or admin. A C saved by a teacher stays an ordinary mark.
--   * Only can_change_office_marks() (is_attendance_office(), i.e.
--     school_office, attendance_officer or admin, or principal) can change or
--     delete an office-locked mark. Anyone else saving it unchanged keeps it
--     as it is (and keeps it the office's), as with planned marks in 389.
--   * Like 389's guard this only checks requests from the app
--     (current_user = 'authenticated'); SECURITY DEFINER functions do their
--     own checks (exclusions by the college secretary overwrite with X, the
--     office's Student Marks, planned absences).
--   * office_locked(attendance) is a computed column the register pages read
--     (select 'office_locked'), so they show the mark read-only.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.can_change_office_marks()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select is_attendance_office() or holds_staff_role('principal');
$$;

revoke execute on function public.can_change_office_marks() from public, anon;
grant execute on function public.can_change_office_marks() to authenticated;

create or replace function public.office_locked(a public.attendance)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.code = 'C' and a.staff_id is not null and exists (
    select 1 from staff_roles sr
    where sr.staff_id = a.staff_id
      and sr.role_name in ('school_office', 'attendance_officer', 'principal', 'admin'));
$$;

revoke execute on function public.office_locked(public.attendance) from public, anon;
grant execute on function public.office_locked(public.attendance) to authenticated;

create or replace function public.attendance_office_lock_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' or not office_locked(old) or can_change_office_marks() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'This mark (C) was set by the school office. Only the school office, the attendance officer or the principal can change it.'
      using errcode = 'insufficient_privilege';
  end if;

  if (new.student_id, new.attend_date, new.period_number, new.code, new.status, coalesce(new.minutes_late, -1))
     is distinct from (old.student_id, old.attend_date, old.period_number, old.code, old.status, coalesce(old.minutes_late, -1)) then
    raise exception 'This mark (C) was set by the school office. Only the school office, the attendance officer or the principal can change it.'
      using errcode = 'insufficient_privilege';
  end if;
  -- Saved unchanged: it stays the office's.
  new.staff_id := old.staff_id;
  new.other_half_activity_id := old.other_half_activity_id;
  return new;
end;
$$;

create or replace trigger trg_attendance_office_lock
  before update or delete on public.attendance
  for each row execute function public.attendance_office_lock_guard();
