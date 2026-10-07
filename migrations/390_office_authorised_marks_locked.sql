-- Migration 390: an authorised absence the office puts on a register is
-- locked to the office.
--
-- Why (the principal, 7 Oct 2026): after migration 389 locked planned-absence
-- marks, the office still also typed codes straight onto registers (five
-- students had C "Other authorised absence" that way on 7 Oct; those were
-- moved into planned absences by hand). The principal wants those locked too.
--
-- The principal's choice: only authorised absences (codes whose status is
-- 'authorized_absence': C, E, H, I, M, X...). The office also takes whole
-- registers (one office login saved 558 present marks in two weeks) and Other
-- Half registers; present, late and N/O marks they save stay ordinary, so a
-- teacher can still correct a register the office took.
--
-- Now:
--   1. attendance.office_locked: set by the database, never by the app, when
--      someone holding school_office or attendance_officer saves a mark with
--      an authorised-absence code. Admin alone doesn't lock (admins who teach
--      would lock their own registers), but admin can still change locked
--      marks, as with planned-absence marks (is_attendance_office()).
--   2. attendance_planned_link_guard() treats an office-locked mark like a
--      planned-absence mark: anyone but the office is refused a change or a
--      delete. When the office changes it, the lock follows the new code
--      (still authorised: locked; anything else: unlocked).
--   3. No back-fill: the only such marks on 7 Oct were already linked to
--      planned absences.

set local formwork.change_note = 'Principal (direct)';

alter table public.attendance
  add column if not exists office_locked boolean not null default false;

create or replace function public.attendance_planned_link_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_office boolean;
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_office := is_attendance_office();

  if tg_op = 'DELETE' then
    if (old.planned_absence_id is not null or old.office_locked) and not v_office then
      raise exception 'This mark (%) was entered by the office. Only the school office or the attendance officer can change it.', old.code
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (old.planned_absence_id is not null or old.office_locked) and not v_office then
    if (new.student_id, new.attend_date, new.period_number, new.code, new.status, coalesce(new.minutes_late, -1))
       is distinct from (old.student_id, old.attend_date, old.period_number, old.code, old.status, coalesce(old.minutes_late, -1)) then
      raise exception 'This mark (%) was entered by the office. Only the school office or the attendance officer can change it.', old.code
        using errcode = 'insufficient_privilege';
    end if;
    new.planned_absence_id := old.planned_absence_id;
    new.office_locked := old.office_locked;
    new.other_half_activity_id := old.other_half_activity_id;
    new.staff_id := old.staff_id;
    return new;
  end if;

  new.planned_absence_id := null;
  new.office_locked := has_staff_role(array['school_office', 'attendance_officer'])
    and exists (select 1 from attendance_codes ac where ac.code = new.code and ac.status = 'authorized_absence');
  return new;
end;
$$;
