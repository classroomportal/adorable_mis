-- Migration 237: resend the parent welcome letter, and message only current
-- students.
--
-- Why (principal, 28 Sept 2026): "We need to be able to send a repeat welcome
-- message to parents and we should only send messages to students who are
-- active."
--
-- 1. Repeat welcome letter. send_parent_welcome_batch() (migration 172) sends
--    each parent the letter once and refuses them after that, so a parent who
--    lost or never saw the email could only be helped by hand. The new
--    resend_parent_welcome_batch() sends it again, but only to parents who
--    were already sent it and have still never signed in. Sending the letter
--    resets the login's password to the date-of-birth password it states, so
--    resending to a parent who has signed in (and chosen their own password)
--    would throw that password away; they're skipped, as in the first send.
--    The password is worked out again from their current children (the
--    oldest may have left since the first letter). parent_welcome_sends keeps
--    the first send's sent_at and gains resend_count and last_sent_at, which
--    parent_welcome_candidates() now returns so the page can show them.
--
-- 2. Messages go to active students only. resolve_message_recipients()
--    matched year group, form, house, mentor group and "all students" on
--    every student row, including the 15 marked 'left', so leavers kept
--    receiving school messages. Those targets now require
--    students.status = 'active', and "all parents" now means parents of at
--    least one active student. 'individual' still sends to exactly the
--    people picked. search_people(), which the compose page uses to pick
--    them, no longer offers leavers.

alter table public.parent_welcome_sends
  add column if not exists resend_count integer not null default 0,
  add column if not exists last_sent_at timestamptz;

update public.parent_welcome_sends set last_sent_at = sent_at where last_sent_at is null;

-- The return type changes, so drop and recreate (grants re-applied below).
drop function if exists public.parent_welcome_candidates();

create function public.parent_welcome_candidates()
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

revoke execute on function public.parent_welcome_candidates() from public, anon;
grant execute on function public.parent_welcome_candidates() to authenticated;

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

revoke execute on function public.resend_parent_welcome_batch(integer[]) from public, anon;
grant execute on function public.resend_parent_welcome_batch(integer[]) to authenticated;

create or replace function public.resolve_message_recipients(p_target_type text, p_target_value text)
returns table(profile_id uuid)
language sql
set search_path to 'public', 'pg_temp'
as $function$
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'year_group' and s.status = 'active' and s.year_group::text = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'form_class' and s.status = 'active' and s.form_class = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'boarding_house' and s.status = 'active' and s.boarding_house = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'mentor_group' and s.status = 'active' and s.mentor_group_id::text = p_target_value
  union
  select p.id from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p_target_type = 'staff_role' and sr.role_name = p_target_value
  union
  select p.id from profiles p
  where p_target_type = 'all_parents' and p.parent_id is not null
    and exists (
      select 1 from student_parent sp
      join students s on s.student_id = sp.student_id
      where sp.parent_id = p.parent_id and s.status = 'active'
    )
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'all_students' and s.status = 'active'
  union
  select p.id from profiles p
  where p_target_type = 'all_staff' and p.staff_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'individual'
    and p.id = any(string_to_array(p_target_value, ',')::uuid[]);
$function$;

create or replace function public.search_people(p_query text)
returns table(profile_id uuid, display_name text, email text, person_type text)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select p.id, stf.first_name || ' ' || stf.last_name, p.email, 'staff'
  from profiles p
  join staff stf on stf.staff_id = p.staff_id
  where stf.first_name || ' ' || stf.last_name ilike '%' || p_query || '%'
  union all
  select p.id, par.first_name || ' ' || par.last_name, par.email, 'parent'
  from profiles p
  join parents par on par.parent_id = p.parent_id
  where par.first_name || ' ' || par.last_name ilike '%' || p_query || '%'
  union all
  select p.id, s.first_name || ' ' || s.last_name, s.student_email, 'student'
  from profiles p
  join students s on s.student_id = p.student_id
  where s.status = 'active'
    and s.first_name || ' ' || s.last_name ilike '%' || p_query || '%'
  limit 20;
$function$;
