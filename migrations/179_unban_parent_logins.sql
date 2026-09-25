-- Migration 179: let parents sign in.
--
-- Why: enforce_abc_domain_login(), a BEFORE INSERT trigger on auth.users
-- created directly against the live database (never committed), sets
-- banned_until = 'infinity' on every new account whose email isn't
-- @abc.sch.ng. Parent logins use parents' own addresses, so every one of
-- them — 1,031 accounts, created from 3 Sep 2026 on — was banned from the
-- moment it was made. Supabase refuses a banned user before checking the
-- password, and the sign-in page only says "Invalid login credentials", so
-- the parents who received welcome letters on 25 Sep could not sign in and
-- would have assumed they had the password wrong. Same "school addresses
-- only" rule as the email block removed on 25 Sep (see
-- supabase/functions/send-workspace-email); the principal asked for parents
-- to be emailed and to use the portal.
--
-- The domain trigger is kept: an account that appears in auth.users
-- without Formwork creating it (e.g. someone signing themselves up with a
-- personal email) should stay locked out. What changes is that an account
-- Formwork has made a parent login — a profiles row with role 'parent' —
-- is unbanned:
--   * now, for every existing parent login;
--   * from now on, by a trigger on profiles, which the parent-login
--     functions (send_parent_welcome_batch, create_parent_logins) write
--     right after inserting the auth.users row, in the same transaction.
-- Only the permanent domain ban is lifted ('infinity'); a time-limited ban
-- set by hand is left alone.

create or replace function public.unban_parent_login()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.role = 'parent' then
    update auth.users
       set banned_until = null
     where id = new.id
       and banned_until = 'infinity';
  end if;
  return new;
end;
$$;

revoke execute on function public.unban_parent_login() from public, anon, authenticated;

drop trigger if exists trg_unban_parent_login on public.profiles;
create trigger trg_unban_parent_login
  after insert or update of role on public.profiles
  for each row execute function public.unban_parent_login();

update auth.users u
   set banned_until = null
  from public.profiles p
 where p.id = u.id
   and p.role = 'parent'
   and u.banned_until = 'infinity';
