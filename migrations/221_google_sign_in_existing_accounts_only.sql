-- 221_google_sign_in_existing_accounts_only.sql
--
-- Staff and students can now sign in with their Google Workspace account
-- (@abc.sch.ng), as the principal asked on 27 Sep 2026. Supabase links a
-- Google sign-in to the existing Formwork login with the same (confirmed)
-- email, so roles, permissions and history carry over unchanged. Every
-- existing login's email is confirmed, so every one of them links.
--
-- What must NOT happen is a Google sign-in creating a brand-new login: a
-- Workspace account Formwork never set up (a new starter not yet added, a
-- leaver whose Workspace account still exists, any other school address)
-- would get an authenticated session, and several tables are readable by
-- any signed-in user (staff names, the calendar, tuckshop items). Logins
-- are only ever created by Formwork itself (create_staff_logins,
-- create_student_logins, the parent-login functions), which insert
-- email-provider accounts directly.
--
-- So enforce_abc_domain_login(), the BEFORE INSERT trigger on auth.users
-- (see migration 179), now refuses any new account whose provider isn't
-- 'email'. It raises rather than banning: a banned leftover account would
-- block that person's real login being created later under the same email.
-- Supabase then sends the sign-in back with an error, and /login explains
-- it ("not set up in Formwork yet"). The existing rule, a new non-school
-- email account is banned until Formwork makes it a parent login, is
-- unchanged.
--
-- This holds whatever Supabase's "allow new users to sign up" setting is.
-- The Google consent screen should also be "Internal" (Workspace accounts
-- only); that and the Google provider itself are set up in the Google and
-- Supabase dashboards, not here.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.enforce_abc_domain_login()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- A sign-in through Google (or any other outside provider) can only link
  -- to a login Formwork already made; it may never create one.
  if coalesce(new.raw_app_meta_data->>'provider', 'email') <> 'email' then
    raise exception 'formwork_no_account: % has no Formwork login', coalesce(new.email, 'this account')
      using errcode = 'insufficient_privilege';
  end if;

  if new.email is not null and new.email not ilike '%@abc.sch.ng' then
    new.banned_until := 'infinity';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_abc_domain_login() from public, anon, authenticated;
