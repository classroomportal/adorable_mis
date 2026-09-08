-- Migration 069: Communication module
-- Compose/send messages to parents, students, or staff, with an in-app inbox
-- (read receipts) and email fanout only for small/targeted sends.
--
-- Design decision: Resend free tier caps at 100/day. Rather than a queue/throttle,
-- large broadcasts (>30 resolved recipients) skip email entirely and are in-app only.
-- Small/targeted messages (<=30) still email each recipient via the same pg_net +
-- Vault pattern as the behaviour-alert trigger.

create table messages (
  id bigint generated always as identity primary key,
  subject text not null,
  body text not null,
  sent_by uuid references auth.users(id),
  target_type text not null,  -- 'year_group' | 'form_class' | 'boarding_house' | 'mentor_group' | 'staff_role' | 'individual' | 'all_parents' | 'all_students' | 'all_staff'
  target_value text,          -- e.g. '9', 'Boys House', 'teacher', or comma list of emails for individual
  recipient_count int not null default 0,
  email_sent boolean not null default false,
  sent_at timestamptz not null default now()
);

create table message_recipients (
  id bigint generated always as identity primary key,
  message_id bigint references messages(id) on delete cascade,
  profile_id uuid references profiles(id),
  read_at timestamptz,
  unique (message_id, profile_id)
);

create index on message_recipients (profile_id) where read_at is null;

-- Resolves target_type/target_value into the set of profile ids to message
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
    and p.email = any(string_to_array(p_target_value, ','));
$$;

-- Sends a message: inserts it, resolves + snapshots recipients, emails only if <=30 recipients.
-- Email address is resolved per profile type: staff/admin use profiles.email directly,
-- parent/student profiles pull the address from parents.email / students.student_email.
create or replace function send_message(
  p_subject text, p_body text, p_target_type text, p_target_value text
) returns bigint
language plpgsql security definer as $$
declare
  v_message_id bigint;
  v_count int;
  v_api_key text;
begin
  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, profile_id from resolve_message_recipients(p_target_type, p_target_value)
  on conflict do nothing;

  select count(*) into v_count from message_recipients where message_id = v_message_id;

  update messages set recipient_count = v_count, email_sent = (v_count <= 30) where id = v_message_id;

  if v_count <= 30 then
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

-- Mark as read (called from the inbox page)
create or replace function mark_message_read(p_message_id bigint) returns void
language sql security definer as $$
  update message_recipients set read_at = now()
  where message_id = p_message_id and profile_id = auth.uid() and read_at is null;
$$;

-- RLS: recipients can only see their own message_recipients rows; senders can see everything they sent
alter table message_recipients enable row level security;
alter table messages enable row level security;

create policy message_recipients_own on message_recipients
  for select using (profile_id = auth.uid());

create policy messages_own_or_sent on messages
  for select using (
    sent_by = auth.uid()
    or exists (select 1 from message_recipients mr where mr.message_id = messages.id and mr.profile_id = auth.uid())
  );

-- Read-receipt view for the sender: who's read a given message
create view message_read_status as
select mr.message_id, mr.profile_id, mr.read_at,
       coalesce(pr.email, par.email, s.student_email) as recipient_email,
       coalesce(stf.first_name || ' ' || stf.last_name, s.first_name || ' ' || s.last_name, par.first_name || ' ' || par.last_name) as recipient_name
from message_recipients mr
join profiles pr on pr.id = mr.profile_id
left join staff stf on stf.staff_id = pr.staff_id
left join students s on s.student_id = pr.student_id
left join parents par on par.parent_id = pr.parent_id;
