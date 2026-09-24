-- 160: parents' first-time password is their oldest child's date of birth,
-- and they must choose their own password the first time they sign in.
--
-- Why: many parents aren't confident with technology, and a random
-- 10-character password like "0b575c25d5" from create_parent_logins() is
-- hard to read, copy and type on a phone. School request (24 Sep 2026): use
-- the date of birth of the parent's oldest child at the school instead, as
-- 8 digits DDMMYYYY (born 24 March 2012 -> 24032012), with no slashes to
-- get wrong.
--
-- A child's date of birth is not a secret (classmates, other parents,
-- birthday posts), so on its own it would leave the account open to anyone
-- who also knows the parent's email. That's why every parent account is
-- flagged must_change_password: RequireAuth sends them to /change-password
-- before any page loads, so the date of birth works exactly once. This does
-- NOT cover the window between the letter going out and the parent's first
-- sign-in; the school accepted that trade-off knowingly.
--
-- Live state when this was written: 1,040 parent logins already exist with
-- random passwords and only 2 have ever been used; no parent had
-- must_change_password set. So besides changing create_parent_logins() for
-- future accounts, this adds reset_parent_passwords_to_dob(), which an
-- admin runs once, deliberately, to move the never-used logins over. It
-- skips anyone who has already signed in (they chose their own password,
-- or at least know the one they have) and anyone with no current child
-- (no date of birth to use; they keep their random password). It returns
-- the same parent_name, email, temp_password columns as
-- create_parent_logins(), so its output pastes straight into
-- /parents/welcome-emails.
--
-- send_parent_welcome_email() now explains where the password comes from
-- when it is the date-of-birth one, and says it must be changed on first
-- sign-in. The parent-email pause from migration 114 is unchanged.
--
-- "Current child" = students.status = 'active' linked via student_parent.
-- Twins share a DOB, so "oldest" is never ambiguous in a way that matters.

-- Internal helper. Deliberately NOT security definer and not callable from
-- the API: it turns a parent_id into a working password, so only the
-- admin-guarded security definer functions below may use it.
create or replace function public.parent_first_password(p_parent_id integer)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select to_char(min(s.dob), 'DDMMYYYY')
  from student_parent sp
  join students s on s.student_id = sp.student_id
  where sp.parent_id = p_parent_id
    and s.status = 'active';
$$;

revoke execute on function public.parent_first_password(integer) from public, anon, authenticated;


-- create_parent_logins: same as before, except the password is the oldest
-- current child's DOB where there is one (random fallback otherwise), and
-- the new profile is flagged to change it on first sign-in.
create or replace function public.create_parent_logins(only_email text default null::text)
 returns table(parent_name text, email text, temp_password text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not is_admin() then
    raise exception 'Only admin can create parent logins';
  end if;

  for rec in
    select p.parent_id, p.first_name, p.last_name, p.email
    from parents p
    where p.email is not null
      and (only_email is null or p.email = only_email)
      and not exists (select 1 from profiles pr where pr.parent_id = p.parent_id)
  loop
    begin
      new_password := coalesce(parent_first_password(rec.parent_id), substr(md5(random()::text), 1, 10));
      new_user_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      insert into profiles (id, role, parent_id, must_change_password) values (new_user_id, 'parent', rec.parent_id, true)
        on conflict (id) do update set role = 'parent', parent_id = rec.parent_id, must_change_password = true;
      parent_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      return next;
    exception when unique_violation then
      parent_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account, likely a shared family email)';
      return next;
    end;
  end loop;
end;
$function$;


-- One-off (re-runnable) move of existing, never-used parent logins onto the
-- date-of-birth password. Run by an admin: select * from reset_parent_passwords_to_dob();
create or replace function public.reset_parent_passwords_to_dob()
 returns table(parent_name text, email text, temp_password text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  rec record;
begin
  if not is_admin() then
    raise exception 'Only admin can reset parent passwords';
  end if;

  for rec in
    select pr.id as profile_id, u.email as login_email, p.first_name, p.last_name,
           parent_first_password(p.parent_id) as pw
    from profiles pr
    join parents p on p.parent_id = pr.parent_id
    join auth.users u on u.id = pr.id
    where pr.role = 'parent'
      and u.last_sign_in_at is null
  loop
    continue when rec.pw is null;

    update auth.users set encrypted_password = crypt(rec.pw, gen_salt('bf')), updated_at = now()
    where id = rec.profile_id;
    update profiles set must_change_password = true where id = rec.profile_id;

    parent_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
    email := rec.login_email;
    temp_password := rec.pw;
    return next;
  end loop;
end;
$function$;

revoke execute on function public.reset_parent_passwords_to_dob() from public, anon;
grant execute on function public.reset_parent_passwords_to_dob() to authenticated;


-- Welcome letter: as migration 159, with the login section explaining the
-- date-of-birth password and the forced change on first sign-in.
create or replace function public.send_parent_welcome_email(p_email text, p_name text, p_temp_password text)
 returns void
 language plpgsql
 security definer
as $function$
declare
  body_html text;
  password_html text;
  v_parent_id integer;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  if parent_emails_paused() then
    raise exception 'Parent emails are currently paused system-wide — no email was sent. Re-enable with: update system_settings set parent_emails_paused = false;';
  end if;

  -- Resolve through the login, not parents.email: 47 emails are shared by
  -- more than one parent row, but each login belongs to exactly one parent.
  select pr.parent_id into v_parent_id
  from auth.users u
  join profiles pr on pr.id = u.id
  where lower(u.email) = lower(p_email) and pr.role = 'parent'
  limit 1;

  if p_temp_password is not distinct from parent_first_password(v_parent_id) then
    password_html := '<strong>Password:</strong> ' || p_temp_password || '</p>' ||
      '<p>Your password is your oldest child''s date of birth, written as 8 numbers: day, month, year, ' ||
      'with no spaces or slashes. For example, a child born on 24 March 2012 would be <strong>24032012</strong>.</p>';
  else
    password_html := '<strong>Password:</strong> ' || p_temp_password || '</p>';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p><strong>Introducing Formwork, our new school information system</strong></p>' ||
    '<p>Adorable British College has introduced a new online system called <strong>Formwork</strong>. ' ||
    'It gives you a parent account where you can follow your child''s school life in one place, ' ||
    'at any time, from a phone, tablet or computer.</p>' ||

    '<p><strong>Formwork is separate from SIMS</strong></p>' ||
    '<p>You may already be familiar with SIMS, including the SIMS Parent app. Formwork is a completely ' ||
    'separate system that runs on a different server from SIMS. This means:</p>' ||
    '<ul>' ||
      '<li>Your SIMS username and password will <strong>not</strong> work on Formwork. Please use the new login details below.</li>' ||
      '<li>Formwork has its own web address, <a href="https://misform.work">misform.work</a>. It is not reached through the SIMS Parent app or the SIMS website.</li>' ||
      '<li>Changing your password in one system does not change it in the other.</li>' ||
    '</ul>' ||

    '<p><strong>What you can see in Formwork</strong></p>' ||
    '<p>For each of your children:</p>' ||
    '<ul>' ||
      '<li>their timetable</li>' ||
      '<li>their results compared with their target grades</li>' ||
      '<li>their behaviour record</li>' ||
      '<li>their attendance, including today lesson by lesson</li>' ||
      '<li>school fees and payment history</li>' ||
      '<li>their tuckshop balance and spending</li>' ||
      '<li>messages from the school in your inbox</li>' ||
    '</ul>' ||

    '<p><strong>Your login details</strong></p>' ||
    '<p><strong>Web address:</strong> <a href="https://misform.work">misform.work</a><br/>' ||
    '<strong>Login email:</strong> ' || p_email || '<br/>' ||
    password_html ||
    '<p>The first time you sign in, Formwork will ask you to choose your own new password ' ||
    '(at least 8 characters). After that, use the new password you chose. ' ||
    'Keep it private: the school will never ask you for it.</p>' ||

    '<p><strong>Need help?</strong></p>' ||
    '<p>If you cannot sign in, or something about your child looks wrong, please contact the school office ' ||
    'and we will be happy to help.</p>' ||

    '<p>Kind regards,<br/>Adorable British College</p>';

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRyanRjZWd0dWNvdmhieWZkcGJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyODk1ODgsImV4cCI6MjEwMzg2NTU4OH0.E6WlnKIOyFtKVTyi0S6sAobUIjThlrCDxNOnK1sGV4k',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', p_email,
      'subject', 'Introducing Formwork: your new parent account (separate from SIMS)',
      'html', body_html
    )
  );
end;
$function$;
