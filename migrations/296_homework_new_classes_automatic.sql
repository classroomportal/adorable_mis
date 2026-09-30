-- Migration 296: new Year 10 and 11 classes get homework automatically.
--
-- Why: migration 295 switched homework on class by class for the Year 10 and
-- 11 teaching groups that existed on 30 Sept 2026. A class created later (a
-- new set from a Nova-T import, or next year's classes at the year switch)
-- would have started with homework off until an admin added it. The
-- principal asked (30 Sept 2026) for that to be automatic.
--
-- Now a trigger on classes switches homework on for any class that is, or
-- becomes, Year 10 or 11 and isn't a Mentor or Prep group. It only ever
-- switches on: a class that changes year or subject keeps homework, and an
-- admin can still switch a class off by removing it from homework_classes
-- (it stays off unless its year or subject changes again). Existing classes
-- are unaffected; they were switched on by 295.
--
-- The function is SECURITY DEFINER because only admins may write
-- homework_classes directly, and it is trigger-only, so execute is revoked
-- from the API roles.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.homework_switch_on_new_class()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- On an update, only when the year or subject really changed, so a
  -- re-import that rewrites the same values doesn't undo an admin's switch-off.
  if tg_op = 'UPDATE' and new.year_group is not distinct from old.year_group
     and new.subject_id is not distinct from old.subject_id then
    return new;
  end if;
  if new.year_group in (10, 11)
     and exists (
       select 1 from subjects s
       where s.subject_id = new.subject_id and s.subject_name not in ('Mentor', 'Prep'))
  then
    insert into homework_classes (class_id) values (new.class_id)
    on conflict (class_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.homework_switch_on_new_class() from public, anon, authenticated;

create trigger trg_homework_switch_on_new_class
  after insert or update of year_group, subject_id on public.classes
  for each row execute function public.homework_switch_on_new_class();
