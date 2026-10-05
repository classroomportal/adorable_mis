-- 372_login_safeguards.sql
--
-- On Sunday 4 Oct 2026 someone on another member of staff's phone signed
-- out of their own login and signed in as principal@ with the Formwork
-- password, then added a staff login and logged a behaviour event in the
-- principal's name. The principal signs in with Google, but the account
-- still had its original email-and-password way in (every login has one;
-- Google sign-in only links to it, migration 221), and changing the Google
-- password does nothing to it. principal@ is also the only admin login.
--
-- Two safeguards, per login, the principal's decision (5 Oct 2026):
--
--   google_only       a sign-in by password (or emailed code / magic link /
--                     reset link) is refused; only Google works. Whoever
--                     knows the Formwork password then has nothing to use.
--   new_device_alert  the first sign-in from a browser/device the login
--                     hasn't used before emails the login's owner (time,
--                     device, network, how they signed in).
--
-- Both are enforced by a BEFORE INSERT trigger on auth.mfa_amr_claims, the
-- row Supabase writes in the same transaction as a new session, carrying
-- how the person signed in ('password', 'oauth', 'otp', ...). Raising there
-- rolls the session back, so no tokens are issued. Token refreshes don't
-- write a claim, so existing sessions are unaffected. The alert is wrapped
-- so that a failure to queue it can never stop a sign-in.
--
-- login_safeguards and login_known_devices have RLS on and no policies or
-- grants on purpose: they are set here or in the SQL editor, never from the
-- app (an admin session must not be able to switch its own safeguard off).
-- To lift Google-only (e.g. if Google sign-in breaks), in the SQL editor:
--   update public.login_safeguards set google_only = false
--   where user_id = (select id from auth.users where email = 'principal@abc.sch.ng');

set local formwork.change_note = 'Principal (direct)';

create table public.login_safeguards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_only boolean not null default false,
  new_device_alert boolean not null default false,
  alert_email text check (alert_email is null or is_plain_email(alert_email)),
  note text,
  added_at timestamptz not null default now()
);
alter table public.login_safeguards enable row level security;
-- No grants: not readable or writable by the API roles (see above).

create table public.login_known_devices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_agent text not null,
  first_seen timestamptz not null default now(),
  first_ip text,
  first_method text
);
create unique index login_known_devices_user_agent on public.login_known_devices (user_id, user_agent);
alter table public.login_known_devices enable row level security;
-- No grants, as above.

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('login_alert', 'New sign-in alert', 'The email to a login''s owner when it is signed in on a device it hasn''t used before.',
   null, 90, false, false, array['principal@abc.sch.ng'])
on conflict (email_kind) do nothing;

create or replace function public.enforce_login_safeguards()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_user uuid;
  v_ua text;
  v_ip text;
  v_rule login_safeguards;
  v_email text;
  v_added integer;
  v_how text;
begin
  select s.user_id, coalesce(nullif(s.user_agent, ''), '(unknown device)'), host(s.ip)
    into v_user, v_ua, v_ip
  from auth.sessions s where s.id = new.session_id;
  if v_user is null then return new; end if;

  select * into v_rule from login_safeguards where user_id = v_user;
  if not found then return new; end if;

  if v_rule.google_only
     and new.authentication_method in ('password', 'otp', 'magiclink', 'recovery', 'invite', 'email/signup', 'email_change') then
    raise exception 'formwork_google_only: this login signs in with Google only'
      using errcode = 'insufficient_privilege';
  end if;

  if v_rule.new_device_alert then
    begin
      insert into login_known_devices (user_id, user_agent, first_ip, first_method)
      values (v_user, v_ua, v_ip, new.authentication_method)
      on conflict (user_id, user_agent) do nothing;
      get diagnostics v_added = row_count;

      if v_added > 0 then
        select coalesce(v_rule.alert_email, u.email) into v_email from auth.users u where u.id = v_user;
        v_how := case new.authentication_method
                   when 'oauth' then 'Google'
                   when 'password' then 'Formwork password'
                   else new.authentication_method end;
        perform queue_workspace_email(jsonb_build_object(
          'to', v_email,
          'subject', 'Formwork: your account was signed in on a new device',
          'html',
            '<p>Your Formwork account (' || html_escape(v_email) || ') was just signed in on a device or browser it hasn''t used before.</p>'
            || '<p><strong>When:</strong> ' || to_char(now() at time zone 'Africa/Lagos', 'Dy DD Mon YYYY, HH24:MI') || ' (Lagos)<br>'
            || '<strong>How:</strong> ' || html_escape(v_how) || '<br>'
            || '<strong>Network address:</strong> ' || html_escape(coalesce(v_ip, 'unknown')) || '<br>'
            || '<strong>Device:</strong> ' || html_escape(v_ua) || '</p>'
            || '<p>If this was you (a new phone, a new browser, or a browser update), there is nothing to do.</p>'
            || '<p>If it wasn''t you, open <a href="https://misform.work/change-password">https://misform.work/change-password</a>, '
            || 'press <em>Sign out all other devices</em>, and change your password.</p>',
          'reply_to', email_reply_to('login_alert')));
      end if;
    exception when others then
      raise warning 'login alert not queued: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_login_safeguards() from public, anon, authenticated;

create trigger enforce_login_safeguards
  before insert on auth.mfa_amr_claims
  for each row execute function public.enforce_login_safeguards();

-- principal@: Google only, and alerts. The two browsers the principal uses
-- (their iPhone and Mac, as of 5 Oct 2026) are known, so they don't alert.
insert into public.login_safeguards (user_id, google_only, new_device_alert, note)
select id, true, true, 'The principal, 5 Oct 2026, after a sign-in with their password on another phone.'
from auth.users where email = 'principal@abc.sch.ng';

insert into public.login_known_devices (user_id, user_agent, first_seen, first_method)
select u.id, d.ua, now(), 'seeded'
from auth.users u
cross join (values
  ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1'),
  ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15')
) d(ua)
where u.email = 'principal@abc.sch.ng';
