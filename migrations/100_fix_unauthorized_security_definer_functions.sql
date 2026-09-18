-- Migration 100: close SECURITY DEFINER functions with no caller authorization at all
--
-- A board security review (18 Sept 2026) found that unlike every other sensitive
-- SECURITY DEFINER function in this schema, the seven below had NO caller check
-- whatsoever — not even the demo-account check send_message() had before
-- migration 091. Supabase grants EXECUTE on every public function to both `anon`
-- and `authenticated` by default, so each of these was callable by literally
-- anyone hitting /rest/v1/rpc/<name> with the public anon key, logged in or not:
--
--   - create_staff_logins() / create_parent_logins() / create_student_logins()
--     create a login for every staff/parent/student who doesn't have one yet
--     and RETURN the plaintext temporary password for each — an anonymous
--     caller could have minted themselves working credentials for any staff
--     member, including admin, or any parent/student.
--   - reset_all_parent_passwords() resets and RETURNS a fresh plaintext
--     password for every parent account in the school, to any caller.
--   - apply_fee_charge_batch() / undo_fee_charge_batch() let any caller create
--     or delete arbitrary fee charges against any student's invoice.
--   - merge_subjects() lets any caller destructively merge/delete subject
--     records, cascading into results, target grades and grade boundaries.
--
-- These already require an admin to run manually from the Supabase SQL editor
-- per house convention (see app/staff/welcome-emails, app/parents/welcome-emails,
-- docs/2026-09-04-session-notes.md) — the fix adds the same enforcement at the
-- database layer that every other privileged RPC in this schema already has,
-- rather than relying on nobody finding the endpoint.

create or replace function public.create_staff_logins(only_email text default null::text)
returns table(staff_name text, email text, temp_password text)
language plpgsql
security definer
as $function$
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

create or replace function public.create_parent_logins(only_email text default null::text)
returns table(parent_name text, email text, temp_password text)
language plpgsql
security definer
as $function$
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

create or replace function public.create_student_logins(only_upn text default null::text)
returns table(student_name text, upn text, email text, temp_password text)
language plpgsql
security definer
as $function$
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

create or replace function public.reset_all_parent_passwords()
returns text
language plpgsql
security definer
as $function$
declare
  rec record;
  new_password text;
  out_text text := 'parent_name,email,temp_password' || chr(10);
begin
  if not is_admin() then
    raise exception 'Only admin can reset parent passwords';
  end if;

  for rec in
    select pr.id as auth_id, p.first_name, p.last_name, p.email
    from profiles pr
    join parents p on p.parent_id = pr.parent_id
    where pr.role = 'parent'
    order by p.last_name
  loop
    new_password := substr(md5(random()::text), 1, 10);
    update auth.users set encrypted_password = crypt(new_password, gen_salt('bf')) where id = rec.auth_id;
    out_text := out_text ||
      '"' || coalesce(rec.first_name, '') || ' ' || coalesce(rec.last_name, '') || '",' ||
      rec.email || ',' || new_password || chr(10);
  end loop;

  return out_text;
end;
$function$;

create or replace function public.apply_fee_charge_batch(p_fee_item_id bigint, p_term_id bigint, p_description text, p_amount numeric, p_target_type text, p_target_value text, p_created_by uuid)
returns table(batch_id bigint, students_charged integer)
language plpgsql
security definer
as $function$
declare
  v_batch_id bigint;
  v_student_id integer;
  v_invoice_id bigint;
  v_count integer := 0;
begin
  if not user_has_staff_role(array['bursar', 'smt']) then
    raise exception 'Only bursar/SMT can apply fee charges';
  end if;

  if p_target_type not in ('individual', 'form_class', 'year_group', 'all') then
    raise exception 'Invalid target_type: %', p_target_type;
  end if;

  insert into fee_charge_batches (fee_item_id, term_id, description, amount, target_type, target_value, created_by)
  values (p_fee_item_id, p_term_id, p_description, p_amount, p_target_type, p_target_value, p_created_by)
  returning id into v_batch_id;

  for v_student_id in
    select s.student_id from students s
    where s.status = 'active'
      and (
        (p_target_type = 'individual' and s.student_id = p_target_value::integer)
        or (p_target_type = 'form_class' and s.form_class = p_target_value)
        or (p_target_type = 'year_group' and s.year_group = p_target_value::integer)
        or (p_target_type = 'all')
      )
  loop
    insert into student_invoices (student_id, term_id)
    values (v_student_id, p_term_id)
    on conflict (student_id, term_id) do nothing;

    select id into v_invoice_id from student_invoices
    where student_id = v_student_id and term_id = p_term_id;

    insert into invoice_line_items (invoice_id, fee_item_id, description, amount, is_extra_charge, batch_id, added_by)
    values (v_invoice_id, p_fee_item_id, p_description, p_amount, true, v_batch_id, p_created_by);

    v_count := v_count + 1;
  end loop;

  return query select v_batch_id, v_count;
end;
$function$;

create or replace function public.undo_fee_charge_batch(p_batch_id bigint)
returns integer
language plpgsql
security definer
as $function$
declare
  v_count integer;
begin
  if not user_has_staff_role(array['bursar', 'smt']) then
    raise exception 'Only bursar/SMT can undo fee charge batches';
  end if;

  delete from invoice_line_items where batch_id = p_batch_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

create or replace function public.merge_subjects(from_id integer, into_id integer)
returns void
language plpgsql
security definer
as $function$
begin
  if not is_admin() then
    raise exception 'Only admin can merge subjects';
  end if;

  update classes set subject_id = into_id where subject_id = from_id;

  update results r
  set subject_id = into_id
  where r.subject_id = from_id
  and not exists (
    select 1 from results r2
    where r2.student_id = r.student_id
    and r2.week_start_date = r.week_start_date
    and r2.subject_id = into_id
  );
  delete from results where subject_id = from_id;

  update target_grades t
  set subject_id = into_id
  where t.subject_id = from_id
  and not exists (
    select 1 from target_grades t2
    where t2.student_id = t.student_id
    and t2.subject_id = into_id
  );
  delete from target_grades where subject_id = from_id;

  update subject_grade_boundaries b
  set subject_id = into_id
  where b.subject_id = from_id
  and not exists (
    select 1 from subject_grade_boundaries b2
    where b2.year_group = b.year_group
    and b2.grade = b.grade
    and b2.subject_id = into_id
  );
  delete from subject_grade_boundaries where subject_id = from_id;

  delete from subjects where subject_id = from_id;
end;
$function$;
