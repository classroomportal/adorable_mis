-- 035_parent_portal.sql
-- Item 4 on the to-do list: parent portal. RLS for parents was already put in place back in
-- migration 027/028 (parent_read_own_contact, parent_read_own_child, parent_read_own_results,
-- parent_read_own_behaviour, parent_read_own_target_grades) — this migration just adds the
-- bulk login creator, mirroring 033's student version.

CREATE OR REPLACE FUNCTION create_parent_logins(only_email TEXT DEFAULT NULL)
RETURNS TABLE(parent_name TEXT, email TEXT, temp_password TEXT) AS $$
DECLARE
  rec RECORD;
  new_password TEXT;
  new_user_id UUID;
BEGIN
  FOR rec IN
    SELECT p.parent_id, p.first_name, p.last_name, p.email
    FROM parents p
    WHERE p.email IS NOT NULL
      AND (only_email IS NULL OR p.email = only_email)
      AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.parent_id = p.parent_id)
  LOOP
    BEGIN
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();

      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change, email_change_token_new
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated',
        rec.email, crypt(new_password, gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}', '{}',
        '', '', '', ''
      );

      INSERT INTO auth.identities (
        id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), new_user_id, new_user_id::text,
        jsonb_build_object('sub', new_user_id::text, 'email', rec.email),
        'email', now(), now(), now()
      );

      INSERT INTO profiles (id, role, parent_id)
      VALUES (new_user_id, 'parent', rec.parent_id)
      ON CONFLICT (id) DO UPDATE SET role = 'parent', parent_id = rec.parent_id;

      parent_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      RETURN NEXT;
    EXCEPTION WHEN unique_violation THEN
      parent_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account, likely a shared family email)';
      RETURN NEXT;
    END;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
