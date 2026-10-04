-- Migration 364: sick-bay log entries the DSL marks as safeguarding are
-- seen by the DSL only.
--
-- Why (the principal, 4 Oct 2026): "DSL can add record and identify it as
-- safeguarding issue and hide details from anyone else." Builds on migration
-- 363 (the dsl role), which must be run first.
--
-- student_clinic_visits.safeguarding: a DSL can tick it when recording a
-- visit, or on an entry the nurse made. While it is ticked the entry is
-- hidden entirely from everyone without the dsl role, the nurses included:
-- it doesn't appear in the log, on the student's medical card or in the
-- clinic dashboard's counts. Hiding the whole row rather than some of its
-- fields is deliberate: row security can't blank columns per row, and a
-- "something happened" stub would itself tell people there is a concern.
--
-- Enforced by one restrictive policy, which is ANDed with the ability
-- policies whatever is ticked: nobody without dsl can read, change or delete
-- such a row, insert one, or set the flag. Only a DSL can untick it, which
-- puts the entry back in the nurses' view. Admin holds no medical ticks
-- since 363, so admins see none of it either.
--
-- safeguarding_flagged_by / _at record who ticked it and when, stamped from
-- auth.uid(); whatever the request sends is overwritten.

set local formwork.change_note = 'Principal (direct)';

alter table public.student_clinic_visits
  add column if not exists safeguarding boolean not null default false,
  add column if not exists safeguarding_flagged_by uuid references auth.users(id),
  add column if not exists safeguarding_flagged_at timestamptz;

create policy safeguarding_dsl_only on public.student_clinic_visits
  as restrictive for all to authenticated
  using (not safeguarding or (select has_staff_role(array['dsl'])))
  with check (not safeguarding or (select has_staff_role(array['dsl'])));

create or replace function public.stamp_clinic_visit_safeguarding()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' or new.safeguarding is distinct from old.safeguarding then
    if new.safeguarding then
      new.safeguarding_flagged_by := auth.uid();
      new.safeguarding_flagged_at := now();
    else
      new.safeguarding_flagged_by := null;
      new.safeguarding_flagged_at := null;
    end if;
  else
    new.safeguarding_flagged_by := old.safeguarding_flagged_by;
    new.safeguarding_flagged_at := old.safeguarding_flagged_at;
  end if;
  return new;
end;
$$;

create trigger trg_stamp_clinic_visit_safeguarding
  before insert or update on public.student_clinic_visits
  for each row execute function public.stamp_clinic_visit_safeguarding();
