-- Migration 251: a student who has left can't sign in.
--
-- Why (principal, 29 Sept 2026): marking a student left removed them from
-- their classes (migration 108/150) but did nothing to their login, so the
-- 14 students marked left this term could still sign in to the student
-- portal, by password or with their school Google account. None of them
-- ever had, but nothing stopped it.
--
-- A login is switched off the same way Formwork already locks accounts
-- (migrations 179, 221): auth.users.banned_until = 'infinity'. Supabase
-- refuses a banned user at every sign-in and token refresh, password or
-- Google alike, so no app change is needed. Their sessions are deleted too,
-- so anyone still signed in is signed out at once rather than when the
-- current token expires. The login itself is kept (not deleted), so a
-- student who returns gets their old account back.
--
--   * now: every student login whose student isn't 'active';
--   * from now on, by a trigger on students: when status changes away from
--     'active' the login is switched off; when it changes back to 'active'
--     it is switched on again (only the permanent 'infinity' lock is lifted,
--     and only for an @abc.sch.ng address, so the domain rule in
--     enforce_abc_domain_login() still holds);
--   * and by a trigger on profiles, for a login made for a student who has
--     already left (e.g. an email added to a leaver's record, which makes a
--     login through trg_student_auto_login).
--
-- Not covered: a student whose leaving date passes with nobody editing
-- their record stays 'active' (auto_set_student_status() only runs when the
-- row is written, and there is no nightly job), so their login stays on
-- until someone saves the record.
--
-- Both functions are SECURITY DEFINER (they write auth.*, which the staff
-- editing a student can't) and only fire from triggers, so EXECUTE is
-- revoked from the API roles.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.set_student_login_lock(p_student_id integer, p_locked boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_locked then
    update auth.users u
       set banned_until = 'infinity'
      from public.profiles p
     where p.id = u.id
       and p.student_id = p_student_id
       and u.banned_until is distinct from 'infinity';

    delete from auth.sessions s
     using public.profiles p
     where p.id = s.user_id
       and p.student_id = p_student_id;
  else
    update auth.users u
       set banned_until = null
      from public.profiles p
     where p.id = u.id
       and p.student_id = p_student_id
       and u.banned_until = 'infinity'
       and u.email ilike '%@abc.sch.ng';
  end if;
end;
$$;

revoke execute on function public.set_student_login_lock(integer, boolean) from public, anon, authenticated;

create or replace function public.lock_login_when_student_leaves()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_table_name = 'students' then
    if new.status is distinct from old.status then
      perform public.set_student_login_lock(new.student_id, new.status <> 'active');
    end if;
  elsif new.student_id is not null then
    -- profiles: a login just made (or re-pointed) for a student who has left
    if exists (select 1 from public.students s
                where s.student_id = new.student_id and s.status <> 'active') then
      perform public.set_student_login_lock(new.student_id, true);
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.lock_login_when_student_leaves() from public, anon, authenticated;

drop trigger if exists trg_lock_login_when_student_leaves on public.students;
-- Any update, not "update of status": auto_set_student_status() can turn a
-- student 'left' from an update that only sets leaving_date, and "update of
-- status" wouldn't fire then. The function itself only acts on a change.
create trigger trg_lock_login_when_student_leaves
  after update on public.students
  for each row execute function public.lock_login_when_student_leaves();

drop trigger if exists trg_lock_login_for_left_student on public.profiles;
create trigger trg_lock_login_for_left_student
  after insert or update of student_id on public.profiles
  for each row execute function public.lock_login_when_student_leaves();

-- Everyone who has already left.
select public.set_student_login_lock(s.student_id, true)
  from public.students s
 where s.status <> 'active'
   and exists (select 1 from public.profiles p where p.student_id = s.student_id);
