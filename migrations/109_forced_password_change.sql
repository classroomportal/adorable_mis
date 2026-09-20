-- 109_forced_password_change.sql
-- Lets a bulk password reset (e.g. all students starting a new term with a
-- shared temporary password) force each affected user to set their own
-- password before they can use the app, rather than leaving a shared
-- password in place indefinitely.

alter table profiles add column if not exists must_change_password boolean not null default false;

-- A user can only ever clear their own flag, and can't touch anything else
-- on their profile (there's no general UPDATE policy on profiles at all) -
-- this is deliberately narrow rather than opening up self-service profile
-- edits.
create or replace function clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update profiles set must_change_password = false where id = auth.uid();
end;
$$;

revoke execute on function clear_must_change_password() from public;
revoke execute on function clear_must_change_password() from anon;
grant execute on function clear_must_change_password() to authenticated;

-- Admin-only bulk reset for active students to one shared password, flagged
-- so each of them is forced to change it on first login. Mirrors
-- reset_all_parent_passwords() but takes a fixed password instead of
-- generating a random one per account, since this is for a shared temporary
-- password handed out to a whole cohort at once, not an individual reset.
create or replace function reset_all_student_passwords(new_password text)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  affected integer;
begin
  if not is_admin() then
    raise exception 'Only admin can reset student passwords';
  end if;

  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf'))
  where id in (
    select pr.id from profiles pr
    join students st on st.student_id = pr.student_id
    where pr.role = 'student' and st.status = 'active'
  );
  get diagnostics affected = row_count;

  update profiles
  set must_change_password = true
  where id in (
    select pr.id from profiles pr
    join students st on st.student_id = pr.student_id
    where pr.role = 'student' and st.status = 'active'
  );

  return affected;
end;
$$;

revoke execute on function reset_all_student_passwords(text) from public;
revoke execute on function reset_all_student_passwords(text) from anon;
grant execute on function reset_all_student_passwords(text) to authenticated;
