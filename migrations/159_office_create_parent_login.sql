-- Migration 159: let the school office create a parent's portal login from
-- the student page.
--
-- Why: the office can now add and correct parents on a student's record
-- (PR #122), but giving a parent a portal login still needed admin: run
-- create_parent_logins() in the SQL editor, then paste its CSV into
-- /parents/welcome-emails. Parent logins are not auto-provisioned the way
-- staff and student logins are (migration 110), so a parent the office adds
-- never gets an account unless someone remembers that step.
--
-- create_parent_login(parent_id) does it for one parent, callable by
-- school_office (and admin, via user_has_staff_role). It creates the login
-- the same way create_parent_logins() does, then:
--   * if parent emails are on, emails the temporary password to the parent
--     and does NOT return it — nobody else needs to see it;
--   * if parent emails are paused (migration 114, currently on since
--     22 Sep 2026 per school request), sends nothing and returns the
--     temporary password once, so the office can hand it over in person or
--     by phone. The school's pause is respected: no email is sent.
--
-- It refuses, before creating anything, when the parent has no email,
-- already has a login, or their email already belongs to another login.
-- That last case is common — at the time of writing 52 of the 55 parents
-- without a login share an email (usually a family one) with a parent who
-- has one — and one auth account can't have two emails, so the office is
-- told rather than getting a half-made account.
--
-- parent_login_status() lets the page show which linked parents have a login
-- without opening profiles (admin-only by RLS) to the office.
--
-- The welcome email's wording moves into parent_welcome_email_post(), an
-- internal helper no API role can call, so send_parent_welcome_email() and
-- the new function share one copy. send_parent_welcome_email() keeps its
-- admin-only guard and pause check exactly as before.

create or replace function public.parent_welcome_email_post(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  body_html text;
  safe_name text := replace(replace(replace(coalesce(p_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
begin
  body_html := '<p>Dear ' || safe_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html
    )
  );
end;
$$;

revoke execute on function public.parent_welcome_email_post(text, text, text) from public, anon, authenticated;

create or replace function public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent. Re-enable with: update system_settings set parent_emails_paused = false;';
  end if;

  perform parent_welcome_email_post(p_email, p_name, p_temp_password);
end;
$$;

create or replace function public.parent_login_status(p_parent_ids integer[])
returns table(parent_id integer, has_login boolean, email_in_use boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.parent_id,
         exists (select 1 from profiles pr where pr.parent_id = p.parent_id),
         p.email is not null and exists (
           select 1 from auth.users u where lower(u.email) = lower(trim(p.email))
         )
    from parents p
   where p.parent_id = any(p_parent_ids)
     and user_has_staff_role(array['school_office']);
$$;

revoke execute on function public.parent_login_status(integer[]) from public, anon;
grant execute on function public.parent_login_status(integer[]) to authenticated;

create or replace function public.create_parent_login(p_parent_id integer)
returns table(login_email text, temp_password text, emailed boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  rec record;
  v_email text;
  new_password text;
  new_user_id uuid;
begin
  if not user_has_staff_role(array['school_office']) then
    raise exception 'Only the school office or admin can create parent logins'
      using errcode = 'insufficient_privilege';
  end if;

  select p.parent_id, p.first_name, p.last_name, p.email
    into rec
    from parents p
   where p.parent_id = p_parent_id
     for update;

  if not found then
    raise exception 'Parent not found';
  end if;

  v_email := lower(trim(rec.email));
  if v_email is null or v_email = '' then
    raise exception 'Add an email address for this parent first — it becomes their login.';
  end if;

  if exists (select 1 from profiles pr where pr.parent_id = p_parent_id) then
    raise exception 'This parent already has a portal login.';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'The email % already belongs to another login (often a shared family email). Give this parent their own email address to create a separate login.', v_email;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', v_email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
  exception when unique_violation then
    raise exception 'The email % already belongs to another login.', v_email;
  end;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', v_email), 'email', now(), now(), now());
  insert into profiles (id, role, parent_id) values (new_user_id, 'parent', p_parent_id)
    on conflict (id) do update set role = 'parent', parent_id = p_parent_id;

  login_email := v_email;
  if parent_emails_paused() then
    temp_password := new_password;
    emailed := false;
  else
    perform parent_welcome_email_post(v_email, trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), new_password);
    temp_password := null;
    emailed := true;
  end if;
  return next;
end;
$$;

revoke execute on function public.create_parent_login(integer) from public, anon;
grant execute on function public.create_parent_login(integer) to authenticated;
