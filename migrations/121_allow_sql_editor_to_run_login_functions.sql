-- 121_allow_sql_editor_to_run_login_functions.sql
--
-- create_staff_logins() (and its student/parent siblings) failed with
-- "Only admin can create staff logins" when run the way the product itself
-- tells you to run it. /staff/welcome-emails says:
--
--     First run `select * from create_staff_logins();` in the Supabase SQL editor
--
-- ...but the guard is `if not is_admin()`, and is_admin() is
-- `profiles.id = auth.uid() and role = 'admin'`. The SQL editor connects as
-- the postgres role with no JWT, so auth.uid() is NULL, is_admin() is false,
-- and the guard always fires. The documented workflow could therefore never
-- have worked from the SQL editor -- the guard only passes for a call coming
-- through PostgREST carrying a logged-in admin's JWT.
--
-- The guard buys nothing against a direct postgres session anyway: that role
-- has rolbypassrls and owns these SECURITY DEFINER functions, so anyone able
-- to open the SQL editor can already do everything the function does by hand.
-- The guard exists to stop anon/authenticated callers reaching it over the
-- API, and that is preserved below unchanged.
--
-- Note the check uses session_user, NOT current_user. These functions are
-- SECURITY DEFINER owned by postgres, so inside the body current_user is
-- always 'postgres' regardless of who called -- testing current_user here
-- would disable the guard for every caller, including anon. session_user
-- keeps the real session role: 'postgres'/'supabase_admin' for a direct
-- connection, 'authenticator' for anything arriving via PostgREST.

create or replace function public.create_staff_logins(only_email text default null::text)
 returns table(staff_name text, email text, temp_password text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can create staff logins';
  end if;

  for rec in
    select s.staff_id, s.first_name, s.last_name, s.email
    from staff s
    where s.email is not null
      and (only_email is null or s.email = only_email)
      and not exists (select 1 from profiles pr where pr.staff_id = s.staff_id)
  loop
    begin
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      insert into profiles (id, role, staff_id, email) values (new_user_id, 'staff', rec.staff_id, rec.email) on conflict (id) do update set role = 'staff', staff_id = rec.staff_id, email = rec.email;
      staff_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      return next;
    exception when unique_violation then
      staff_name := coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account)';
      return next;
    end;
  end loop;
end;
$function$;

create or replace function public.create_student_logins(only_upn text default null::text)
 returns table(student_name text, upn text, email text, temp_password text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only admin can create student logins';
  end if;

  for rec in
    select s.student_id, s.first_name, s.last_name, s.upn, s.student_email
    from students s
    where s.student_email is not null
      and (only_upn is null or s.upn = only_upn)
      and not exists (select 1 from profiles p where p.student_id = s.student_id)
  loop
    new_password := substr(md5(random()::text), 1, 10);
    new_user_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
      '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
      rec.student_email, crypt(new_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), new_user_id, new_user_id::text,
      jsonb_build_object('sub', new_user_id::text, 'email', rec.student_email),
      'email', now(), now(), now()
    );

    insert into profiles (id, role, student_id)
    values (new_user_id, 'student', rec.student_id)
    on conflict (id) do update set role = 'student', student_id = rec.student_id;

    student_name := rec.first_name || ' ' || rec.last_name;
    upn := rec.upn;
    email := rec.student_email;
    temp_password := new_password;
    return next;
  end loop;
end;
$function$;

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
  if not (is_admin() or session_user in ('postgres', 'supabase_admin')) then
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
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      insert into profiles (id, role, parent_id) values (new_user_id, 'parent', rec.parent_id) on conflict (id) do update set role = 'parent', parent_id = rec.parent_id;
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
