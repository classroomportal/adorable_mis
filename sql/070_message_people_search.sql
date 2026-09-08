-- Migration 070: Searchable individual recipient picker; simplify email rule.
-- New rule: individual messages always email (you picked one person, you want them to see it).
-- Group/broadcast messages are always in-app only, never email. No recipient-count threshold.

-- Search staff, students, and parents by name, returning their profile_id (if they have a login)
-- and best-known email, for the compose page's "find a person" picker.
create or replace function search_people(p_query text)
returns table (profile_id uuid, display_name text, email text, person_type text)
language sql stable as $$
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
  where s.first_name || ' ' || s.last_name ilike '%' || p_query || '%'
  limit 20;
$$;

-- Individual targeting now uses a comma-separated list of profile ids (not emails,
-- since parent/student profiles.email is usually null — see search_people above).
create or replace function resolve_message_recipients(p_target_type text, p_target_value text)
returns table (profile_id uuid) language sql as $$
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'year_group' and s.year_group::text = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'form_class' and s.form_class = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'boarding_house' and s.boarding_house = p_target_value
  union
  select p.id from profiles p
  join students s on s.student_id = p.student_id
  where p_target_type = 'mentor_group' and s.mentor_group_id::text = p_target_value
  union
  select p.id from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where p_target_type = 'staff_role' and sr.role_name = p_target_value
  union
  select p.id from profiles p
  where p_target_type = 'all_parents' and p.parent_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'all_students' and p.student_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'all_staff' and p.staff_id is not null
  union
  select p.id from profiles p
  where p_target_type = 'individual'
    and p.id = any(string_to_array(p_target_value, ',')::uuid[]);
$$;

create or replace function send_message(
  p_subject text, p_body text, p_target_type text, p_target_value text
) returns bigint
language plpgsql security definer as $$
declare
  v_message_id bigint;
  v_count int;
  v_api_key text;
  v_should_email boolean;
begin
  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, profile_id from resolve_message_recipients(p_target_type, p_target_value)
  on conflict do nothing;

  select count(*) into v_count from message_recipients where message_id = v_message_id;

  -- individual sends always email; every group/broadcast type is in-app only
  v_should_email := (p_target_type = 'individual');

  update messages set recipient_count = v_count, email_sent = v_should_email where id = v_message_id;

  if v_should_email then
    select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'resend_api_key';

    if v_api_key is not null then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', 'Adorable MIS <no-reply@mis.classroomportal.org>',
          'to', coalesce(pr.email, par.email, st.student_email),
          'subject', p_subject,
          'text', p_body || E'\n\nView in your portal: https://mis.classroomportal.org/inbox'
        )
      )
      from profiles pr
      join message_recipients mr on mr.profile_id = pr.id
      left join parents par on par.parent_id = pr.parent_id
      left join students st on st.student_id = pr.student_id
      where mr.message_id = v_message_id
        and coalesce(pr.email, par.email, st.student_email) is not null;
    end if;
  end if;

  return v_message_id;
end;
$$;
