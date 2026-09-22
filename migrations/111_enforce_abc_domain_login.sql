-- 111_enforce_abc_domain_login.sql
-- Policy from the principal: no system email may reach parents, and no
-- login is allowed for any account outside @abc.sch.ng. This is the login
-- half - the email half is enforced in the send-workspace-email Edge
-- Function (it drops any non-@abc.sch.ng recipient before sending).
--
-- auth.users.banned_until is GoTrue's own mechanism for blocking sign-in
-- at the auth layer itself (not just hiding data via RLS) - a banned user's
-- /token requests are rejected outright. Setting it to 'infinity' bans
-- indefinitely; clearing it (set to null) un-bans.
--
-- Two parts: ban every existing non-@abc.sch.ng account now (in practice
-- this is ~1030 of 1040 parent accounts - students and staff are already
-- all on the school domain), and a trigger so any future account created
-- outside the domain is banned from the moment it's inserted, rather than
-- relying on every account-creation code path to remember the rule.

update auth.users
set banned_until = 'infinity'
where email is not null
  and email not ilike '%@abc.sch.ng'
  and (banned_until is null or banned_until < now());

create or replace function enforce_abc_domain_login()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is not null and new.email not ilike '%@abc.sch.ng' then
    new.banned_until := 'infinity';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_abc_domain_login on auth.users;
create trigger trg_enforce_abc_domain_login
  before insert on auth.users
  for each row
  execute function enforce_abc_domain_login();
