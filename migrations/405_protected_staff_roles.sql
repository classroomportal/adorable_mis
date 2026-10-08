-- Migration 405: only the principal gives or removes the DSL and guidance
-- roles.
--
-- Why (the principal, 8 Oct 2026): "still cant see guidance role". The Staff
-- Roles page had no label for `dsl` or `guidance` (nor
-- `lesson_feedback_reviewer`), so Osione's guidance role showed as a blank
-- chip and couldn't be found in the list. The page now lists every role in
-- `roles`, in alphabetical order, with a label.
--
-- Showing them there meant closing a gap: `dsl` and `guidance` open every
-- worry with the student's name (and `dsl` the safeguarding sick-bay notes),
-- and until now nothing in the database stopped anyone allowed to edit
-- `staff_roles` (an ability tick) from giving them out; it was only that the
-- page didn't offer them. guard_protected_staff_roles() on staff_roles
-- refuses adding, changing or removing a `dsl` or `guidance` row from anyone
-- signed in who isn't a holder of `principal` (holds_staff_role(), so admin
-- is not enough). Migrations and the SQL editor (no sign-in) still can. The
-- page shows the two roles with a padlock to everyone else.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.guard_protected_staff_roles()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_protected text[] := array['dsl', 'guidance'];
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and old.role_name = any (v_protected))
     or (tg_op in ('INSERT', 'UPDATE') and new.role_name = any (v_protected)) then
    if not holds_staff_role('principal') then
      raise exception 'Only the principal can give or remove the DSL and Guidance & Counselling roles.';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.guard_protected_staff_roles() from public, anon, authenticated;

create trigger trg_guard_protected_staff_roles
  before insert or update or delete on public.staff_roles
  for each row execute function public.guard_protected_staff_roles();
