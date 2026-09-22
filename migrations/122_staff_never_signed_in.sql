-- 122_staff_never_signed_in.sql
--
-- Backs the rebuilt /staff/welcome-emails page.
--
-- The old page's whole premise was stale. It told the admin to run
-- create_staff_logins() in the SQL editor and paste the resulting CSV of
-- plaintext temporary passwords back into a textarea. Since migration 110
-- auto-provisions a login the moment staff.email is set, that function has
-- nothing left to create -- all 54 staff with an email already have an
-- account, so it returns zero rows and the page can never do anything.
--
-- The real remaining need is the other half: staff whose account exists but
-- who have never actually signed in (8 of the 54 at the time of writing).
-- They need a way in, and the product already has the right mechanism for
-- that -- the password-reset email behind /login/forgot -- rather than
-- minting and emailing a plaintext password.
--
-- auth.users is not reachable over PostgREST, so the page cannot ask "who
-- has never signed in?" directly. This exposes exactly that one question
-- and nothing more. Deliberately a SECURITY DEFINER function guarded by
-- is_admin(), not a view: a view over auth.users joined to staff would be
-- readable by anyone the staff table is readable by, which is how the
-- PII-leaking view described in sql/CURRENT_SCHEMA.md happened. The
-- function returns only what the page renders -- name, email, when the
-- account was made -- and never password hashes or tokens.
--
-- Note this does NOT create logins. Creating a staff login stays where it
-- already is: the admin-gated path (the auto-provision trigger on staff, and
-- create_staff_logins() behind its is_admin() guard). This function only
-- reports who is stuck, so an admin can re-send them a reset link.

create or replace function public.staff_never_signed_in()
returns table(staff_id integer, staff_name text, email text, account_created timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can list staff who have never signed in';
  end if;

  return query
    select s.staff_id,
           trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
           s.email,
           u.created_at
    from staff s
    join profiles p on p.staff_id = s.staff_id
    join auth.users u on u.id = p.id
    where s.email is not null
      and u.last_sign_in_at is null
    order by u.created_at, s.last_name;
end;
$$;

revoke execute on function public.staff_never_signed_in() from public;
revoke execute on function public.staff_never_signed_in() from anon;
grant execute on function public.staff_never_signed_in() to authenticated;
