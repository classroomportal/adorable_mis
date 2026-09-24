-- Migration 172: send parent welcome emails by year group, from the page,
-- and never to the same parent twice.
--
-- Why: /parents/welcome-emails only worked by an admin running
-- create_parent_logins() (or reset_parent_passwords_to_dob()) in the SQL
-- editor and pasting its CSV output into the page. There was no way to send
-- one year group at a time, and nothing recorded who had already been sent a
-- letter, so a second batch could email the same parents again.
--
-- Since migration 160 a parent's first password is their oldest current
-- child's date of birth, so the database can work it out itself — the page
-- never needs to see or be handed a password.
--
--   parent_welcome_sends          one row per parent who has been sent the
--                                 letter. Starts empty: nothing recorded sends
--                                 before this, and any letter sent before
--                                 migration 160 carried a random password that
--                                 has since been reset, so it no longer works.
--   parent_welcome_candidates()   every parent with a current child, their
--                                 children's year groups, and whether they can
--                                 be sent the letter (and if not, why).
--   send_parent_welcome_batch()   sends to the chosen parents: creates the
--                                 login if there isn't one, sets the password
--                                 to the date of birth (so the password in the
--                                 letter is guaranteed to work), flags it to be
--                                 changed on first sign-in, sends the letter,
--                                 and records the send. Parents already sent,
--                                 or who have already signed in, are skipped
--                                 here — not just hidden on the page.
--
-- The parent-email pause (migration 114) still applies: the batch refuses to
-- send anything while it is on.
--
-- create_parent_login() (the office's one-parent button, migration 159) now
-- records its send too, so a parent it emailed isn't emailed again by a batch.
--
-- Also re-applies migration 169's Vault rewrite: migration 160 re-created
-- send_parent_welcome_email() after 169 ran, putting the literal key back.

create table if not exists parent_welcome_sends (
  parent_id integer primary key references parents(parent_id) on delete cascade,
  email text not null,
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid()
);

comment on table parent_welcome_sends is
  'One row per parent who has been sent the portal welcome letter. Written only by send_parent_welcome_batch() and create_parent_login(); a parent with a row is never sent it again.';

alter table parent_welcome_sends enable row level security;

drop policy if exists "parent_welcome_sends readable by admin" on parent_welcome_sends;
create policy "parent_welcome_sends readable by admin" on parent_welcome_sends
  for select using (is_admin());


create or replace function public.parent_welcome_candidates()
returns table(
  parent_id integer,
  parent_name text,
  email text,
  children text,
  years integer[],
  status text,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
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
         coalesce(u.email::text, nullif(lower(trim(p.email)), '')),
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
         ws.sent_at
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
$$;

revoke execute on function public.parent_welcome_candidates() from public, anon;
grant execute on function public.parent_welcome_candidates() to authenticated;


create or replace function public.send_parent_welcome_batch(p_parent_ids integer[])
returns table(parent_id integer, email text, outcome text)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
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
      -- Locked so two batches running at once can't both send to one parent:
      -- the second waits here, then sees the first one's send below.
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
        -- Never signed in, so nobody is using the current password: set it to
        -- the date of birth the letter is about to tell them.
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
      -- Only this parent's changes roll back; the rest of the batch carries on.
      outcome := 'Error: ' || sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke execute on function public.send_parent_welcome_batch(integer[]) from public, anon;
grant execute on function public.send_parent_welcome_batch(integer[]) to authenticated;


-- create_parent_login: unchanged from the live definition, except that when
-- it emails the parent it records the send.
create or replace function public.create_parent_login(p_parent_id integer)
 returns table(login_email text, temp_password text, emailed boolean)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  rec record;
  v_email text;
  new_password text;
  new_user_id uuid;
begin
  if not user_has_staff_role(array['school_office']) then
    raise exception 'Only the school office or admin can create parent logins'
      using errcode = 'insufficient_privilege';
  end if;

  select p.parent_id, p.first_name, p.last_name, p.email
    into rec
    from parents p
   where p.parent_id = p_parent_id
     for update;

  if not found then
    raise exception 'Parent not found';
  end if;

  v_email := lower(trim(rec.email));
  if v_email is null or v_email = '' then
    raise exception 'Add an email address for this parent first — it becomes their login.';
  end if;

  if exists (select 1 from profiles pr where pr.parent_id = p_parent_id) then
    raise exception 'This parent already has a portal login.';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'The email % already belongs to another login (often a shared family email). Give this parent their own email address to create a separate login.', v_email;
  end if;

  new_password := substr(md5(random()::text), 1, 10);
  new_user_id := gen_random_uuid();
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
    values ('00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', v_email, crypt(new_password, gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
  exception when unique_violation then
    raise exception 'The email % already belongs to another login.', v_email;
  end;
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), new_user_id, new_user_id::text, jsonb_build_object('sub', new_user_id::text, 'email', v_email), 'email', now(), now(), now());
  insert into profiles (id, role, parent_id) values (new_user_id, 'parent', p_parent_id)
    on conflict (id) do update set role = 'parent', parent_id = p_parent_id;

  login_email := v_email;
  if parent_emails_paused() then
    temp_password := new_password;
    emailed := false;
  else
    perform parent_welcome_email_post(v_email, trim(coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '')), new_password);
    insert into parent_welcome_sends (parent_id, email) values (p_parent_id, v_email)
      on conflict (parent_id) do nothing;
    temp_password := null;
    emailed := true;
  end if;
  return next;
end;
$function$;


-- Migration 169's rewrite again, for whatever still carries a literal key
-- (send_parent_welcome_email, re-created by migration 160). Same body as 169.
do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ '''Bearer eyJ[A-Za-z0-9._-]+'''
  loop
    v_def := regexp_replace(
      pg_get_functiondef(f.oid),
      '''Bearer eyJ[A-Za-z0-9._-]+''',
      '''Bearer '' || coalesce(public.send_workspace_email_key(), '''')',
      'g'
    );
    execute v_def;
    raise notice 'Key now read from Vault in %', f.proname;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ 'Bearer eyJ'
  ) then
    raise exception 'A public function still has a literal send-workspace-email key';
  end if;
end $$;
