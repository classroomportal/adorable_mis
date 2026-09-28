-- Migration 245: a student's login follows a change to their email.
--
-- Why (principal, 28 Sept 2026): after correcting Donatella IKEDIFE's (Y8)
-- email in her core data and sending her a new welcome from
-- /students/welcome-emails, nothing arrived. The page sends the password-set
-- link to students.student_email, but the login (auth.users.email) was still
-- the old address, s.donate.ikedife@. Supabase Auth answers a reset for an
-- address with no login with a silent success, so the page reported "sent"
-- and no email went anywhere. Same gap as migration 244 for parents.
--
-- trg_provision_student_login() only ever created a login when the student
-- had none, and returned early otherwise, so a later email change was ignored.
-- Now, when student_email changes and the student has a login they've never
-- signed in with, the login moves to the new address. A student who has
-- signed in is left alone (they sign in with their login email). If the new
-- address already belongs to another login the save is refused with a message
-- saying so, rather than leaving the record and login silently out of step.
--
-- The trigger function is SECURITY DEFINER (it writes auth.users); it only
-- runs from the trigger, so API roles don't need to execute it.

create or replace function public.trg_provision_student_login()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  new_password text;
  new_user_id uuid;
  student_name text;
  v_login uuid;
  v_current text;
  v_signed_in timestamptz;
  v_new text;
begin
  if new.student_email is null then
    return new;
  end if;

  select p.id into v_login from profiles p where p.student_id = new.student_id limit 1;
  if found then
    v_new := nullif(lower(trim(new.student_email)), '');
    if tg_op <> 'UPDATE' or v_new is null
       or v_new = lower(trim(coalesce(old.student_email, ''))) then
      return new;
    end if;

    select u.email, u.last_sign_in_at into v_current, v_signed_in
    from auth.users u where u.id = v_login;
    if v_signed_in is not null or v_new = lower(v_current) then
      return new;
    end if;

    if exists (select 1 from auth.users u where lower(u.email) = v_new and u.id <> v_login) then
      raise exception 'The email % is already used by another login, so it can''t be given to this student.', v_new;
    end if;

    update auth.users set email = v_new, updated_at = now() where id = v_login;
    update auth.identities
      set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new)), updated_at = now()
    where user_id = v_login and provider = 'email';
    update profiles set email = v_new where id = v_login and email is not null;
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
$function$;

revoke execute on function public.trg_provision_student_login() from public, anon, authenticated;

-- Bring existing never-signed-in logins into step with the record (on
-- 28 Sept 2026 this was only Donatella IKEDIFE, student 98).
do $$
declare
  r record;
begin
  for r in
    select s.student_id, lower(trim(s.student_email)) as new_email, u.id as login
    from students s
    join profiles p on p.student_id = s.student_id
    join auth.users u on u.id = p.id
    where s.student_email is not null
      and u.last_sign_in_at is null
      and lower(trim(s.student_email)) <> lower(u.email)
      and not exists (select 1 from auth.users x where lower(x.email) = lower(trim(s.student_email)) and x.id <> u.id)
  loop
    update auth.users set email = r.new_email, updated_at = now() where id = r.login;
    update auth.identities
      set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(r.new_email)), updated_at = now()
    where user_id = r.login and provider = 'email';
    update profiles set email = r.new_email where id = r.login and email is not null;
  end loop;
end $$;
