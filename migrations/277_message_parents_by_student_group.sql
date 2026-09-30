-- Migration 277: message the parents of any group of students, by email too.
--
-- Why (principal, 30 Sept 2026): /comms/compose could only send a year group,
-- form, house or mentor group message to the *students* themselves, in their
-- inbox only; the only way to reach parents as a group was "All parents".
-- The school needs to write to parents chosen by groups of students (Year 10
-- parents, one boarding house's parents, the parents of a class or an Other
-- Half activity), and those parents need an email, since most don't check
-- the portal inbox.
--
-- Also fixes "Check recipient count" always saying 0: the page called
-- resolve_message_recipients() directly, which ran as the signed-in member of
-- staff, and RLS on profiles hid everyone else's login from them. The count
-- now comes from message_recipient_preview(), which runs with the same
-- rights, and the same list, as the send.
--
-- What changes:
--   * messages.audience: for a student group, who it goes to: 'students',
--     'parents' (every parent with a login linked to those students) or
--     'both'. NULL for staff and individual messages, and for every message
--     sent before this migration (they went to students).
--   * Student groups: all_students, year_group, form_class, boarding_house,
--     mentor_group, sports_house, class (a teaching class, by class_id) and
--     other_half (an Other Half activity, by activity_id). Several values of
--     one kind can be chosen at once; target_value holds them comma-separated.
--     staff_role takes several too. Leavers are never included (migration 237).
--   * Parents in a group message are emailed as well as getting it in their
--     inbox, unless parent emails are paused (then inbox only). Students and
--     staff in group messages stay inbox-only, as before; an individual
--     message is emailed to everyone, as before.
--   * Parents with no login (never sent their welcome letter) can't be
--     reached: there is no inbox to put it in, and the email's link is to
--     that inbox. The preview counts them so the sender knows.
--   * "All parents" is kept as a target type (old messages use it), and means
--     the same as all_students with audience 'parents'.
--
-- resolve_message_recipients() had one caller, send_message(); both are
-- replaced. The new recipient helper is only called from the two
-- SECURITY DEFINER functions, which check the caller first, so API roles
-- can't execute it. send_message() keeps its permission check (smt, pastoral,
-- school_office, or admin through user_has_staff_role()); its old
-- is_demo_account() check is dropped with the training account it guarded.

alter table public.messages
  add column if not exists audience text
  check (audience in ('students', 'parents', 'both'));

drop function if exists public.send_message(text, text, text, text);
drop function if exists public.resolve_message_recipients(text, text);

-- The active students in a student group (none for a target type that isn't
-- a student group).
create or replace function public.message_group_students(p_target_type text, p_values text[])
returns table(student_id integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select s.student_id from students s
  where s.status = 'active'
    and (
      p_target_type in ('all_students', 'all_parents')
      or (p_target_type = 'year_group' and s.year_group::text = any(p_values))
      or (p_target_type = 'form_class' and s.form_class = any(p_values))
      or (p_target_type = 'boarding_house' and s.boarding_house = any(p_values))
      or (p_target_type = 'mentor_group' and s.mentor_group_id::text = any(p_values))
      or (p_target_type = 'sports_house' and s.sports_house = any(p_values))
      or (p_target_type = 'class' and exists (
            select 1 from student_class sc
            where sc.student_id = s.student_id and sc.class_id::text = any(p_values)))
      or (p_target_type = 'other_half' and exists (
            select 1 from other_half_choices oc
            where oc.student_id = s.student_id and oc.activity_id::text = any(p_values)))
    );
$function$;

revoke execute on function public.message_group_students(text, text[]) from public, anon, authenticated;

create or replace function public.message_recipient_list(p_target_type text, p_target_value text, p_audience text)
returns table(profile_id uuid, kind text)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_values text[] := array(select trim(v) from unnest(string_to_array(coalesce(p_target_value, ''), ',')) v where trim(v) <> '');
  v_audience text := case when p_target_type = 'all_parents' then 'parents' else coalesce(p_audience, 'students') end;
begin
  if p_target_type in ('all_students', 'all_parents', 'year_group', 'form_class', 'boarding_house',
                       'mentor_group', 'sports_house', 'class', 'other_half') then
    if p_target_type not in ('all_students', 'all_parents') and cardinality(v_values) = 0 then
      raise exception 'Choose at least one group.';
    end if;

    return query
    with st as (select g.student_id from message_group_students(p_target_type, v_values) g)
    select p.id, 'student'::text from profiles p
    where v_audience in ('students', 'both') and p.student_id in (select st.student_id from st)
    union
    select p.id, 'parent'::text from profiles p
    where v_audience in ('parents', 'both') and p.role = 'parent'
      and exists (select 1 from student_parent sp
                  where sp.parent_id = p.parent_id and sp.student_id in (select st.student_id from st));
    return;
  end if;

  if p_audience is not null then
    raise exception 'Students, parents or both can only be chosen for a group of students.';
  end if;

  if p_target_type = 'staff_role' then
    return query
    select distinct p.id, 'staff'::text from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where sr.role_name = any(v_values);
  elsif p_target_type = 'all_staff' then
    return query
    select p.id, 'staff'::text from profiles p where p.staff_id is not null;
  elsif p_target_type = 'individual' then
    return query
    select p.id, case when p.parent_id is not null then 'parent' when p.student_id is not null then 'student' else 'staff' end
    from profiles p
    where p.id = any(v_values::uuid[]);
  else
    raise exception 'Unknown message target: %', p_target_type;
  end if;
end;
$function$;

revoke execute on function public.message_recipient_list(text, text, text) from public, anon, authenticated;

create or replace function public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text, p_audience text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_message_id bigint;
  v_count int;
  v_emailed int := 0;
begin
  if not user_has_staff_role(array['smt', 'pastoral', 'school_office']) then
    raise exception 'You do not have permission to send messages.';
  end if;

  insert into messages (subject, body, sent_by, target_type, target_value, audience)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value,
          case when p_target_type = 'all_parents' then 'parents' else p_audience end)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, r.profile_id from message_recipient_list(p_target_type, p_target_value, p_audience) r
  on conflict do nothing;

  select count(*) into v_count from message_recipients mr where mr.message_id = v_message_id;

  -- An individual message is emailed to everyone on it; a group message to
  -- its parents only. Parents are never emailed while parent emails are
  -- paused (migration 114); they still get it in their inbox.
  with sent as (
    select public.queue_workspace_email(jsonb_build_object(
        'to', coalesce(pr.email, par.email, st.student_email),
        'subject', p_subject,
        'text', p_body || E'\n\nView in your portal: https://misform.work/inbox',
        'reply_to', email_reply_to(case when pr.parent_id is not null then 'message_parent' else 'message_staff_student' end)
      ))
    from profiles pr
    join message_recipients mr on mr.profile_id = pr.id
    left join parents par on par.parent_id = pr.parent_id
    left join students st on st.student_id = pr.student_id
    where mr.message_id = v_message_id
      and (p_target_type = 'individual' or pr.parent_id is not null)
      and coalesce(pr.email, par.email, st.student_email) is not null
      and not (pr.parent_id is not null and parent_emails_paused())
  )
  select count(*) into v_emailed from sent;

  update messages set recipient_count = v_count, email_sent = v_emailed > 0 where id = v_message_id;

  return v_message_id;
end;
$function$;

revoke execute on function public.send_message(text, text, text, text, text) from public, anon;
grant execute on function public.send_message(text, text, text, text, text) to authenticated;

-- What "Check recipient count" shows: who a message would reach, and the
-- parents of those students it can't (no login yet).
create or replace function public.message_recipient_preview(p_target_type text, p_target_value text, p_audience text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_values text[] := array(select trim(v) from unnest(string_to_array(coalesce(p_target_value, ''), ',')) v where trim(v) <> '');
  v_out jsonb;
begin
  if not user_has_staff_role(array['smt', 'pastoral', 'school_office']) then
    raise exception 'You do not have permission to send messages.';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'students', count(*) filter (where r.kind = 'student'),
    'parents', count(*) filter (where r.kind = 'parent'),
    'staff', count(*) filter (where r.kind = 'staff'),
    'parent_emails_paused', parent_emails_paused()
  ) into v_out
  from message_recipient_list(p_target_type, p_target_value, p_audience) r;

  if p_target_type = 'all_parents' or coalesce(p_audience, 'students') in ('parents', 'both') then
    v_out := v_out || jsonb_build_object('parents_without_login', (
      select count(distinct sp.parent_id)
      from student_parent sp
      where sp.student_id in (select g.student_id from message_group_students(p_target_type, v_values) g)
        and not exists (select 1 from profiles pr where pr.parent_id = sp.parent_id and pr.role = 'parent')
    ));
  end if;

  return v_out;
end;
$function$;

revoke execute on function public.message_recipient_preview(text, text, text) from public, anon;
grant execute on function public.message_recipient_preview(text, text, text) to authenticated;
