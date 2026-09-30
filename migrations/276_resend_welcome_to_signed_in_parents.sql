-- Migration 276: the welcome letter can be sent again to parents who have
-- already signed in, resetting their password.
--
-- Why (principal, 30 Sept 2026): parents who have signed in and chosen their
-- own password also need to be able to get a fresh letter with a reset, e.g.
-- when they've forgotten the password they chose. Until now
-- resend_parent_welcome_batch() (migrations 237, 244) skipped anyone who had
-- signed in, to protect the password they'd chosen, and parents who had a
-- login but were never sent the letter from /parents/welcome-emails (status
-- 'signed_in') couldn't be sent it at all.
--
-- Now a resend goes to any parent with a login, signed in or not. Their
-- password is reset to the date-of-birth password the letter gives and they
-- must choose a new one when they next sign in, exactly as for a parent who
-- hasn't signed in. A parent who had never been sent the letter gets a
-- parent_welcome_sends row, so they show as "Already sent" afterwards.
--
-- Unchanged: admin only, blocked while parent emails are paused, at most 500
-- at a time. A signed-in parent's login email is still left as it is
-- (sync_parent_login_email() only moves it for parents who have never signed
-- in), so the letter goes to the address they sign in with. Parents with no
-- login yet still get their first letter from "Not sent yet"
-- (send_parent_welcome_batch(), unchanged), since that is what creates it.

create or replace function public.resend_parent_welcome_batch(p_parent_ids integer[])
returns table(parent_id integer, email text, outcome text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_id integer;
  rec record;
  v_login uuid;
  v_email text;
  v_name text;
  v_pw text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails' using errcode = 'insufficient_privilege';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent.';
  end if;

  if coalesce(array_length(p_parent_ids, 1), 0) > 500 then
    raise exception 'Send at most 500 parents at a time.';
  end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_parent_ids) x)
  loop
    parent_id := v_id;
    email := null;
    begin
      select p.parent_id, p.first_name, p.last_name into rec
      from parents p where p.parent_id = v_id
      for update;
      if not found then
        outcome := 'Skipped: parent not found';
        return next; continue;
      end if;

      select pr.id, u.email into v_login, v_email
      from profiles pr join auth.users u on u.id = pr.id
      where pr.parent_id = v_id and pr.role = 'parent'
      limit 1;
      if not found then
        outcome := 'Skipped: no login yet (send it from "Not sent yet")';
        return next; continue;
      end if;

      email := v_email;
      v_pw := parent_first_password(v_id);
      if v_pw is null then
        outcome := 'Skipped: no date of birth on file for a current child';
        return next; continue;
      end if;

      v_email := sync_parent_login_email(v_id, v_login);
      email := v_email;
      update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now()
      where id = v_login;
      update profiles set must_change_password = true where id = v_login;

      v_name := coalesce(nullif(trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), ''), 'Parent');
      perform send_parent_welcome_email(v_email, v_name, v_pw);
      insert into parent_welcome_sends as ws (parent_id, email) values (v_id, v_email)
      on conflict on constraint parent_welcome_sends_pkey do update
        set resend_count = ws.resend_count + 1, last_sent_at = now(), email = excluded.email;
      outcome := 'Sent';
      return next;
    exception when others then
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$function$;
