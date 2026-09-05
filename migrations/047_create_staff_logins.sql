-- Migration 047: create_staff_logins()
-- Mirrors create_parent_logins() exactly (same auth.users/auth.identities
-- structure and bcrypt hashing via crypt()/gen_salt('bf')) so staff logins
-- are created the identical, GoTrue-compatible way.

CREATE OR REPLACE FUNCTION public.create_staff_logins(only_email text DEFAULT NULL::text)
 RETURNS TABLE(staff_name text, email text, temp_password text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  rec RECORD;
  new_password TEXT;
  new_user_id UUID;
BEGIN
  FOR rec IN
    SELECT s.staff_id, s.first_name, s.last_name, s.email
    FROM staff s
    WHERE s.email IS NOT NULL
      AND (only_email IS NULL OR s.email = only_email)
      AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.staff_id = s.staff_id)
  LOOP
    BEGIN
      new_password := substr(md5(random()::text), 1, 10);
      new_user_id := gen_random_uuid();
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new) VALUES ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', rec.email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) VALUES (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', rec.email), 'email', now(), now(), now());
      INSERT INTO profiles (id, role, staff_id, email) VALUES (new_user_id, 'staff', rec.staff_id, rec.email) ON CONFLICT (id) DO UPDATE SET role = 'staff', staff_id = rec.staff_id, email = rec.email;
      staff_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := new_password;
      RETURN NEXT;
    EXCEPTION WHEN unique_violation THEN
      staff_name := COALESCE(rec.first_name, '') || ' ' || COALESCE(rec.last_name, '');
      email := rec.email;
      temp_password := '(skipped — email already used by another account)';
      RETURN NEXT;
    END;
  END LOOP;
END;
$function$;
