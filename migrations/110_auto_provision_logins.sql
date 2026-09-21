-- 110_auto_provision_logins.sql
-- Login creation for staff and students was entirely manual: adding a staff
-- or student record never created their auth account - someone had to
-- remember to run create_staff_logins()/create_student_logins() in the SQL
-- editor afterwards and paste the CSV into a welcome-emails page (see
-- docs/todo.md). A staff member (pa2@abc.sch.ng) was added, that step got
-- skipped, and she ended up with no profile and no auth.users row at all -
-- "reset password" and "resend" both had nothing to act on.
--
-- This closes the gap at the source: the moment a staff or student row gets
-- an email (at creation or via a later edit), a trigger creates the login
-- and emails the temporary password straight to them, the same way the
-- existing manual functions do it but without a human needing to remember.
-- create_staff_logins()/create_student_logins() and the welcome-emails pages
-- stay in place as a manual catch-up path (bulk imports, or re-sending).

create or replace function send_student_welcome_email(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a student account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your results, target grades, timetable and behaviour record.</p>' ||
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
      'subject', 'Your Adorable MIS student account',
      'html', body_html
    )
  );
end;
$$;

revoke execute on function send_student_welcome_email(text, text, text) from public;
revoke execute on function send_student_welcome_email(text, text, text) from anon;
grant execute on function send_student_welcome_email(text, text, text) to authenticated;

-- Fires after a staff row's email is set (creation or a later edit). Runs as
-- the trigger owner regardless of who made the edit, so it isn't gated by
-- is_admin() itself - the staff table's own RLS already decides who can
-- write here. A failed or slow email send is caught so it never blocks the
-- staff record being saved; the welcome-emails page remains as a manual
-- fallback if the automatic send doesn't land.
create or replace function trg_provision_staff_login()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_password text;
  new_user_id uuid;
  staff_name text;
begin
  if new.email is null then
    return new;
  end if;
  if exists (select 1 from profiles where staff_id = new.staff_id) then
    return new;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();

  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', new.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', new.email), 'email', now(), now(), now());

    insert into profiles (id, role, staff_id, email)
    values (new_user_id, 'staff', new.staff_id, new.email);
  exception when unique_violation then
    -- Email already used by another auth account - leave it for a human to sort out.
    return new;
  end;

  staff_name := coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '');
  begin
    perform send_staff_welcome_email(new.email, staff_name, new_password);
  exception when others then
    raise notice 'Welcome email failed for %: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_staff_auto_login on staff;
create trigger trg_staff_auto_login
  after insert or update of email on staff
  for each row
  execute function trg_provision_staff_login();

-- Same pattern for students, keyed on student_email rather than email.
create or replace function trg_provision_student_login()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  new_password text;
  new_user_id uuid;
  student_name text;
begin
  if new.student_email is null then
    return new;
  end if;
  if exists (select 1 from profiles where student_id = new.student_id) then
    return new;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();

  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', new.student_email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', new.student_email), 'email', now(), now(), now());

    insert into profiles (id, role, student_id, email)
    values (new_user_id, 'student', new.student_id, new.student_email);
  exception when unique_violation then
    return new;
  end;

  student_name := coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, '');
  begin
    perform send_student_welcome_email(new.student_email, student_name, new_password);
  exception when others then
    raise notice 'Welcome email failed for %: %', new.student_email, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_student_auto_login on students;
create trigger trg_student_auto_login
  after insert or update of student_email on students
  for each row
  execute function trg_provision_student_login();
