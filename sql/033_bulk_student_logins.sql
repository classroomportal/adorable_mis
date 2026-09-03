-- 033_bulk_student_logins.sql
-- Creates a Supabase Auth login + linked profile for every student who has a student_email
-- on file and doesn't already have a login. Returns the generated temp passwords so they can
-- be distributed to students. This writes directly to auth.users/auth.identities, which is a
-- community technique rather than an officially documented API — test on one student first.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION create_student_logins(only_upn TEXT DEFAULT NULL)
RETURNS TABLE(student_name TEXT, upn TEXT, email TEXT, temp_password TEXT) AS $$
DECLARE
  rec RECORD;
  new_password TEXT;
  new_user_id UUID;
BEGIN
  FOR rec IN
    SELECT s.student_id, s.first_name, s.last_name, s.upn, s.student_email
    FROM students s
    WHERE s.student_email IS NOT NULL
      AND (only_upn IS NULL OR s.upn = only_upn)
      AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.student_id = s.student_id)
  LOOP
    new_password := substr(md5(random()::text), 1, 10);
    new_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
      rec.student_email, crypt(new_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}',
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), new_user_id, new_user_id::text,
      jsonb_build_object('sub', new_user_id::text, 'email', rec.student_email),
      'email', now(), now(), now()
    );

    INSERT INTO profiles (id, role, student_id)
    VALUES (new_user_id, 'student', rec.student_id)
    ON CONFLICT (id) DO UPDATE SET role = 'student', student_id = rec.student_id;

    student_name := rec.first_name || ' ' || rec.last_name;
    upn := rec.upn;
    email := rec.student_email;
    temp_password := new_password;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
