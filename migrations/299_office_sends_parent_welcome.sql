-- Migration 299: the school office can send parent welcome letters.
--
-- Why (principal, 1 Oct 2026): the office looks after parents' logins and
-- already has the /parents/welcome-emails page in role_permissions, but every
-- function behind it still said "Only admin can send welcome emails", so the
-- page refused them. The office needs to send first letters and resends
-- itself rather than ask an admin each time.
--
-- Now admin or a holder of the school_office staff role (checked through
-- user_has_staff_role(), i.e. auth.uid(), never anything the page sends) can:
--   - list the candidates          parent_welcome_candidates()
--   - send first letters            send_parent_welcome_batch()
--   - send the letter again         resend_parent_welcome_batch()
--   - and the letter itself         send_parent_welcome_email()
-- The bodies are otherwise exactly as they were (migrations 237, 244, 276).
--
-- Unchanged: the system-wide parent email pause switch
-- (set_parent_emails_paused()) stays admin-only; the office can see whether
-- emails are paused but not turn them on or off, and nothing is sent while
-- they are paused. Still at most 500 parents a send.

create or replace function public.parent_welcome_candidates()
 returns table(parent_id integer, parent_name text, email text, children text, years integer[], status text, sent_at timestamp with time zone, last_sign_in_at timestamp with time zone, resend_count integer, last_sent_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if not (is_admin() or user_has_staff_role(array['school_office'])) then
    raise exception 'Only admin and the school office can send welcome emails' using errcode = 'insufficient_privilege';
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
  v_email text;
  v_name text;
  v_pw text;
begin
  if not (is_admin() or user_has_staff_role(array['school_office'])) then
    raise exception 'Only admin and the school office can send welcome emails' using errcode = 'insufficient_privilege';
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

      select pr.id, u.email into v_login, v_email
      from profiles pr join auth.users u on u.id = pr.id
      where pr.parent_id = v_id and pr.role = 'parent'
      limit 1;
      if not found then
        outcome := 'Skipped: no login yet (send it from "Not sent yet")';
        return next; continue;
      end if;

      email := v_email;
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
      insert into parent_welcome_sends as ws (parent_id, email) values (v_id, v_email)
      on conflict on constraint parent_welcome_sends_pkey do update
        set resend_count = ws.resend_count + 1, last_sent_at = now(), email = excluded.email;
      outcome := 'Sent';
      return next;
    exception when others then
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
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
  if not (is_admin() or user_has_staff_role(array['school_office'])) then
    raise exception 'Only admin and the school office can send welcome emails' using errcode = 'insufficient_privilege';
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
  if not (is_admin() or user_has_staff_role(array['school_office'])) then
    raise exception 'Only admin and the school office can send welcome emails';
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

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Introducing Formwork: your new parent account (separate from SIMS)',
      'html', body_html,
      'reply_to', email_reply_to('parent_welcome')
    )
  );
end;
$function$;
