-- Migration 244: a welcome letter goes to the parent's current email.
--
-- Why (principal, 28 Sept 2026): after changing a parent's email on their
-- record, /parents/welcome-emails still showed and sent to the old address.
-- The welcome functions (migrations 172, 237) send to the parent's *login*
-- email (auth.users.email), and editing parents.email never touches the
-- login, so the new address was ignored. Seen on parent 888, whose login
-- was still the address the letter had gone to on 25 Sept.
--
-- Now, for a parent who has never signed in, sending or resending the letter
-- first moves their login to the email on their parent record
-- (sync_parent_login_email()), and parent_welcome_candidates() shows that
-- address. A parent who has signed in is left alone: they sign in with their
-- login email, and they're never sent the letter anyway. If the new address
-- already belongs to another login the send stops for that parent with a
-- message saying so, rather than giving two people one address.
--
-- The helper is only called from the two SECURITY DEFINER batch functions,
-- which check is_admin() first, so API roles can't execute it.

create or replace function public.sync_parent_login_email(p_parent_id integer, p_login uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current text;
  v_signed_in timestamptz;
  v_new text;
begin
  select u.email, u.last_sign_in_at into v_current, v_signed_in
  from auth.users u where u.id = p_login;

  select nullif(lower(trim(p.email)), '') into v_new
  from parents p where p.parent_id = p_parent_id;

  if v_signed_in is not null or v_new is null or v_new = lower(v_current) then
    return v_current;
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_new and u.id <> p_login) then
    raise exception 'new email % is already used by another login', v_new;
  end if;

  update auth.users set email = v_new, updated_at = now() where id = p_login;
  update auth.identities
    set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(v_new)), updated_at = now()
  where user_id = p_login and provider = 'email';
  update profiles set email = v_new where id = p_login and email is not null;

  return v_new;
end;
$function$;

revoke execute on function public.sync_parent_login_email(integer, uuid) from public, anon, authenticated;

create or replace function public.parent_welcome_candidates()
returns table(parent_id integer, parent_name text, email text, children text, years integer[], status text,
              sent_at timestamptz, last_sign_in_at timestamptz, resend_count integer, last_sent_at timestamptz)
language plpgsql
stable security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails' using errcode = 'insufficient_privilege';
  end if;

  return query
  with kids as (
    select sp.parent_id,
           array_agg(distinct s.year_group order by s.year_group) as years,
           string_agg(distinct s.first_name || ' ' || s.last_name || ' (Y' || s.year_group || ')', ', ') as children
    from student_parent sp
    join students s on s.student_id = sp.student_id
    where s.status = 'active'
    group by sp.parent_id
  )
  select p.parent_id,
         nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
         -- The address the letter goes to: the parent record's email until
         -- they've signed in (sync_parent_login_email() moves the login to
         -- it on sending), their login email after.
         case
           when u.last_sign_in_at is null then coalesce(nullif(lower(trim(p.email)), ''), u.email::text)
           else u.email::text
         end,
         k.children,
         k.years,
         case
           when ws.parent_id is not null then 'sent'
           when u.last_sign_in_at is not null then 'signed_in'
           when u.id is null and coalesce(trim(p.email), '') = '' then 'no_email'
           when parent_first_password(p.parent_id) is null then 'no_dob'
           when u.id is null and exists (
             select 1 from auth.users x where lower(x.email) = lower(trim(p.email))
           ) then 'email_shared'
           else 'ready'
         end,
         ws.sent_at,
         u.last_sign_in_at,
         coalesce(ws.resend_count, 0),
         ws.last_sent_at
  from parents p
  join kids k on k.parent_id = p.parent_id
  left join lateral (
    select pr.id from profiles pr
    where pr.parent_id = p.parent_id and pr.role = 'parent'
    limit 1
  ) login on true
  left join auth.users u on u.id = login.id
  left join parent_welcome_sends ws on ws.parent_id = p.parent_id
  order by p.last_name, p.first_name;
end;
$function$;

create or replace function public.send_parent_welcome_batch(p_parent_ids integer[])
returns table(parent_id integer, email text, outcome text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_id integer;
  rec record;
  v_login uuid;
  v_signed_in timestamptz;
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
      select p.parent_id, p.first_name, p.last_name, p.email into rec
      from parents p where p.parent_id = v_id
      for update;
      if not found then
        outcome := 'Skipped: parent not found';
        return next; continue;
      end if;

      if exists (select 1 from parent_welcome_sends ws where ws.parent_id = v_id) then
        outcome := 'Skipped: already sent';
        return next; continue;
      end if;

      select pr.id, u.last_sign_in_at, u.email into v_login, v_signed_in, v_email
      from profiles pr join auth.users u on u.id = pr.id
      where pr.parent_id = v_id and pr.role = 'parent'
      limit 1;
      if not found then
        v_login := null; v_signed_in := null; v_email := null;
      end if;

      if v_signed_in is not null then
        outcome := 'Skipped: has already signed in';
        email := v_email;
        return next; continue;
      end if;

      v_pw := parent_first_password(v_id);
      if v_pw is null then
        outcome := 'Skipped: no date of birth on file for a current child';
        return next; continue;
      end if;

      if v_login is null then
        v_email := nullif(lower(trim(rec.email)), '');
        email := v_email;
        if v_email is null then
          outcome := 'Skipped: no email address';
          return next; continue;
        end if;
        if exists (select 1 from auth.users u where lower(u.email) = v_email) then
          outcome := 'Skipped: email already used by another parent''s login';
          return next; continue;
        end if;

        v_login := gen_random_uuid();
        insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
        values ('00000000-0000-0000-0000-000000000000', v_login, 'authenticated', 'authenticated', v_email, crypt(v_pw, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
        insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (gen_random_uuid(), v_login, v_login::text, jsonb_build_object('sub', v_login::text, 'email', v_email), 'email', now(), now(), now());
        insert into profiles (id, role, parent_id, must_change_password) values (v_login, 'parent', v_id, true)
          on conflict (id) do update set role = 'parent', parent_id = v_id, must_change_password = true;
      else
        v_email := sync_parent_login_email(v_id, v_login);
        update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now()
        where id = v_login;
        update profiles set must_change_password = true where id = v_login;
      end if;

      email := v_email;
      v_name := coalesce(nullif(trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), ''), 'Parent');
      perform send_parent_welcome_email(v_email, v_name, v_pw);
      insert into parent_welcome_sends (parent_id, email) values (v_id, v_email);
      outcome := 'Sent';
      return next;
    exception when others then
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$function$;

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
  v_signed_in timestamptz;
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

      if not exists (select 1 from parent_welcome_sends ws where ws.parent_id = v_id) then
        outcome := 'Skipped: never sent the letter (send it from "Not sent yet")';
        return next; continue;
      end if;

      select pr.id, u.last_sign_in_at, u.email into v_login, v_signed_in, v_email
      from profiles pr join auth.users u on u.id = pr.id
      where pr.parent_id = v_id and pr.role = 'parent'
      limit 1;
      if not found then
        outcome := 'Skipped: no login';
        return next; continue;
      end if;

      email := v_email;
      if v_signed_in is not null then
        outcome := 'Skipped: has already signed in';
        return next; continue;
      end if;

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
      update parent_welcome_sends ws
        set resend_count = ws.resend_count + 1, last_sent_at = now(), email = v_email
      where ws.parent_id = v_id;
      outcome := 'Sent';
      return next;
    exception when others then
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$function$;
