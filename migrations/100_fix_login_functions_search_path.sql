-- Fix create_student_logins / create_parent_logins / create_staff_logins:
-- a prior search_path hardening pass (applied directly against the live DB,
-- not captured in a migration -- found via schema drift while investigating
-- why create_student_logins() failed for the 21 new joiners) set these to
-- SET search_path TO 'public', 'pg_temp'. pgcrypto (crypt/gen_salt, used to
-- hash the temp password) lives in the 'extensions' schema on this project,
-- not 'public', so every call to these three functions has been failing
-- with "function gen_salt(unknown) does not exist" since that change.
-- Adding 'extensions' back to the search_path restores them without
-- reintroducing the mutable-search-path risk the hardening pass targeted.

CREATE OR REPLACE FUNCTION public.create_student_logins(only_upn text DEFAULT NULL::text)
 RETURNS TABLE(student_name text, upn text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not is_admin() then
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

CREATE OR REPLACE FUNCTION public.create_parent_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(parent_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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

CREATE OR REPLACE FUNCTION public.create_staff_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(staff_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  rec record;
  new_password text;
  new_user_id uuid;
begin
  if not is_admin() then
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
