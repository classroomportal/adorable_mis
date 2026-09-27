-- 226_email_reply_routes.sql
--
-- Where replies to Formwork's emails go is now set from a page,
-- /admin/email-replies, instead of being written into the email functions.
--
-- Migration 225 gave every email a Reply-To, with the addresses the
-- principal chose hardcoded into each function. The principal asked
-- (27 Sep 2026) for those choices to live on an admin page so they can be
-- changed later without a migration.
--
-- email_reply_routes has one row per kind of email. Each row can send
-- replies to any mix of:
--   * the member of staff behind the email (only where there is one: the
--     sender of a message, the teacher who logged a behaviour event),
--   * everyone who holds the SMT role, looked up when the email is queued,
--   * a list of addresses.
-- A kind that resolves to nobody (e.g. a sender with no email on their
-- staff record) uses the "fallback" row, which must always name someone.
-- queue_workspace_email keeps sro@abc.sch.ng as a last resort in case even
-- that fails.
--
-- The rows are seeded with exactly what 225 hardcoded, so nothing changes
-- for anyone the day this is applied.
--
-- Rows are fixed by migration (the page edits them; nobody adds or removes
-- kinds), so the API gets SELECT and UPDATE only. The principal asked for
-- the page to be SMT and admin only, so RLS checks the SMT role itself
-- (user_has_staff_role, which admins also pass), not has_resource_access:
-- granting the page to another role at /admin/permissions shows them the
-- link but still lets them read or change nothing. Changes are logged in
-- change_history under a new `email` area, and updated_by is stamped from
-- auth.uid().
--
-- email_reply_to(kind) resolves a row to addresses. It is SECURITY DEFINER
-- and not executable by API roles: the sender is always auth.uid(), never
-- an argument. The page shows who SMT currently is through
-- email_reply_smt_preview(), which checks the caller is SMT or admin.
--
-- The email functions from 225 are rewritten with only their reply_to
-- lines changed (send_message also loses its sender lookup, which moves
-- into email_reply_to).

set local formwork.change_note = 'Principal (direct)';

-- A plain address, as the send-workspace-email edge function accepts it
-- (the edge function refuses the whole email otherwise). Lower case only:
-- everything that uses it lowercases first.
create or replace function public.is_plain_email(p text)
returns boolean
language sql
immutable
as $function$
  select p ~ '^[^\s@<>(),;:"\[\]\\]+@[a-z0-9-]+(\.[a-z0-9-]+)+$';
$function$;

create table public.email_reply_routes (
  email_kind      text primary key,
  label           text not null,
  description     text not null,
  sender_label    text,
  sort_order      integer not null,
  reply_to_sender boolean not null default false,
  reply_to_smt    boolean not null default false,
  addresses       text[] not null default '{}',
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id),
  constraint email_reply_sender_needs_one check (sender_label is not null or not reply_to_sender),
  constraint email_reply_fallback_needs_someone check (email_kind <> 'fallback' or reply_to_smt or cardinality(addresses) > 0)
);

comment on table public.email_reply_routes is
  'Where replies to each kind of Formwork email go. Edited at /admin/email-replies; read by email_reply_to().';

alter table public.email_reply_routes enable row level security;

grant select, update on public.email_reply_routes to authenticated;

create policy smt_read_email_reply_routes on public.email_reply_routes
  for select using (user_has_staff_role(array['smt']));

create policy smt_update_email_reply_routes on public.email_reply_routes
  for update using (user_has_staff_role(array['smt']))
  with check (user_has_staff_role(array['smt']));

-- Lowercase, trim and de-duplicate the addresses, and refuse anything that
-- isn't a plain address with a message the page can show as it is.
create or replace function public.tidy_email_reply_route()
returns trigger
language plpgsql
as $function$
declare
  v_bad text;
begin
  new.addresses := coalesce(array(
    select distinct lower(trim(a)) from unnest(new.addresses) a
    where length(trim(a)) > 0 order by 1), '{}');
  select string_agg(a, ', ') into v_bad from unnest(new.addresses) a where not is_plain_email(a);
  if v_bad is not null then
    raise exception 'Not an email address: %', v_bad;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

create trigger tidy_email_reply_route
  before insert or update on public.email_reply_routes
  for each row execute function public.tidy_email_reply_route();

create trigger stamp_email_reply_route_updated_by
  before insert or update on public.email_reply_routes
  for each row execute function public.stamp_actor('updated_by');

alter table public.change_history drop constraint change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email'));

create trigger log_email_reply_routes
  after insert or update or delete on public.email_reply_routes
  for each row execute function public.log_change('email', 'email_kind');

-- Seeded with migration 225's choices.
insert into public.email_reply_routes
  (email_kind, sort_order, label, description, sender_label, reply_to_sender, reply_to_smt, addresses)
values
  ('message_parent', 10, 'Message to a parent',
   'A message sent to one parent from Send Message.',
   'The member of staff who sent it', false, false, array['sro@abc.sch.ng']),
  ('message_staff_student', 20, 'Message to staff or a student',
   'A message sent to one member of staff or one student from Send Message.',
   'The member of staff who sent it', true, false, '{}'),
  ('parent_welcome', 30, 'Parent login details',
   'The welcome email with a parent''s login, sent in a batch or when the office creates one login.',
   null, false, false, array['sro@abc.sch.ng']),
  ('staff_student_welcome', 40, 'Staff and student login details',
   'The welcome email sent when a member of staff or a student is given an email address.',
   null, false, false, array['sro@abc.sch.ng']),
  ('behaviour_alert', 50, 'Behaviour alert',
   'The alert to cs@abc.sch.ng (SMT and the SRO copied in) after a -5 event or a week at -8.',
   'The member of staff who logged the event', false, false, array['guardian.counselling@abc.sch.ng']),
  ('detention', 60, 'Detention emails to students',
   'A detention being set, cancelled, and the reminder the day before.',
   null, false, true, '{}'),
  ('fallback', 100, 'Anything else',
   'Any other email, and any kind above that works out to nobody (such as a sender with no email on their staff record).',
   null, false, false, array['sro@abc.sch.ng']);

-- The addresses replies to one kind of email go to, as a JSON array.
-- Empty when the row works out to nobody; queue_workspace_email then uses
-- the fallback row.
create or replace function public.email_reply_to(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(distinct a), '[]'::jsonb)
  from email_reply_routes r
  cross join lateral (
    select unnest(r.addresses) as a
    union all
    select lower(trim(st.email))
      from profiles me
      join staff st on st.staff_id = me.staff_id
     where r.reply_to_sender and me.id = auth.uid()
    union all
    select unnest(smt_reply_to_addresses()) where r.reply_to_smt
  ) x
  where r.email_kind = p_kind and is_plain_email(a);
$function$;

revoke execute on function public.email_reply_to(text) from public, anon, authenticated;

-- Who "SMT" is right now, for the page. Same SMT-or-admin rule as the table.
create or replace function public.email_reply_smt_preview()
returns text[]
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not user_has_staff_role(array['smt']) then
    raise exception 'You do not have access to email reply settings.' using errcode = 'insufficient_privilege';
  end if;
  return smt_reply_to_addresses();
end;
$function$;

revoke execute on function public.email_reply_smt_preview() from public, anon;
grant execute on function public.email_reply_smt_preview() to authenticated;

-- The page, on the Administration tile, for SMT and admin.
insert into resources (resource_key, label, section, sort_order) values
  ('/admin/email-replies', 'Email Replies', 'Administration', 96)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('admin', '/admin/email-replies'),
  ('smt', '/admin/email-replies')
on conflict do nothing;

create or replace function public.queue_workspace_email(p_body jsonb)
returns bigint
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with reply as (
    select coalesce(jsonb_agg(distinct a),
                    nullif(email_reply_to('fallback'), '[]'::jsonb),
                    '["sro@abc.sch.ng"]'::jsonb) as addresses
    from (
      select lower(trim(x)) as a
      from jsonb_array_elements_text(
        case jsonb_typeof(p_body -> 'reply_to')
          when 'array' then p_body -> 'reply_to'
          when 'string' then jsonb_build_array(p_body -> 'reply_to')
          else '[]'::jsonb
        end) x
    ) r
    where is_plain_email(a)
  ),
  body as (
    select p_body || jsonb_build_object('reply_to', reply.addresses) as b
    from reply
  )
  insert into email_outbox (payload, recipient, subject)
  select
    b,
    case jsonb_typeof(b -> 'to')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(b -> 'to') x)
      else b ->> 'to'
    end
    || coalesce(' (cc: ' || case jsonb_typeof(b -> 'cc')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(b -> 'cc') x)
      else b ->> 'cc'
    end || ')', ''),
    b ->> 'subject'
  from body
  returning email_id;
$function$;

revoke execute on function public.queue_workspace_email(jsonb) from public, anon, authenticated;

create or replace function public.send_message(p_subject text, p_body text, p_target_type text, p_target_value text)
returns bigint
language plpgsql
security definer
as $function$
declare
  v_message_id bigint;
  v_count int;
  v_should_email boolean;
begin
  if is_demo_account() then
    raise exception 'Communication is disabled for the training account — no message was sent.';
  end if;

  if not user_has_staff_role(array['smt', 'pastoral', 'school_office']) then
    raise exception 'You do not have permission to send messages.';
  end if;

  insert into messages (subject, body, sent_by, target_type, target_value)
  values (p_subject, p_body, auth.uid(), p_target_type, p_target_value)
  returning id into v_message_id;

  insert into message_recipients (message_id, profile_id)
  select v_message_id, profile_id from resolve_message_recipients(p_target_type, p_target_value)
  on conflict do nothing;

  select count(*) into v_count from message_recipients where message_id = v_message_id;

  v_should_email := (p_target_type = 'individual');

  update messages set recipient_count = v_count, email_sent = v_should_email where id = v_message_id;

  if v_should_email then
    -- Where replies go is set at /admin/email-replies (migration 226).
    perform public.queue_workspace_email( jsonb_build_object(
        'to', coalesce(pr.email, par.email, st.student_email),
        'subject', p_subject,
        'text', p_body || E'\n\nView in your portal: https://misform.work/inbox',
        'reply_to', email_reply_to(case when pr.parent_id is not null then 'message_parent' else 'message_staff_student' end)
      )
    )
    from profiles pr
    join message_recipients mr on mr.profile_id = pr.id
    left join parents par on par.parent_id = pr.parent_id
    left join students st on st.student_id = pr.student_id
    where mr.message_id = v_message_id
      and coalesce(pr.email, par.email, st.student_email) is not null
      and not (pr.parent_id is not null and parent_emails_paused());
  end if;

  return v_message_id;
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
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
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

create or replace function public.parent_welcome_email_post(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  body_html text;
  safe_name text := replace(replace(replace(coalesce(p_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
begin
  body_html := '<p>Dear ' || safe_name || ',</p>' ||
    '<p>Adorable British College now has an online parent portal, <strong>Adorable MIS</strong>, where you can view your child''s weekly results compared to their target grades, and their behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS parent portal account',
      'html', body_html,
      'reply_to', email_reply_to('parent_welcome')
    )
  );
end;
$function$;

create or replace function public.send_staff_welcome_email(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a staff account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your timetable, take attendance registers, enter results, and access student and behaviour records relevant to your role.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS staff account',
      'html', body_html,
      'reply_to', email_reply_to('staff_student_welcome')
    )
  );
end;
$function$;

create or replace function public.send_student_welcome_email(p_email text, p_name text, p_temp_password text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  body_html text;
begin
  if not is_admin() then
    raise exception 'Only admin can send welcome emails';
  end if;

  body_html := '<p>Dear ' || p_name || ',</p>' ||
    '<p>You now have a student account on <strong>Adorable MIS</strong>, Adorable British College''s Management Information System, where you can view your results, target grades, timetable and behaviour record.</p>' ||
    '<p><strong>Login email:</strong> ' || p_email || '<br/>' ||
    '<strong>Temporary password:</strong> ' || p_temp_password || '</p>' ||
    '<p>Please sign in at <a href="https://misform.work">misform.work</a> and change your password on first login (use "Change Password" in the menu).</p>' ||
    '<p>Kind regards,<br/>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', p_email,
      'subject', 'Your Adorable MIS student account',
      'html', body_html,
      'reply_to', email_reply_to('staff_student_welcome')
    )
  );
end;
$function$;

create or replace function public.notify_pastoral_on_negative_behaviour()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  alert_to constant text := 'cs@abc.sch.ng';
  student_name text;
  cc_list text[];
  subject text;
  body_html text;
  week_start date;
  week_end date;
  week_total integer;
  reason text;
  v_key text;
begin
  if new.is_demo then
    return new;
  end if;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if new.points <= -5 then
    reason := 'A single severe event was logged (' || new.points || ' points).';
  elsif week_total <= -8 then
    reason := 'Their running total for the week (Sat ' || week_start || ' – Fri ' || week_end || ') has reached ' || week_total || ' points.';
  else
    return new;
  end if;

  select first_name || ' ' || last_name into student_name from students where student_id = new.student_id;

  select array_agg(distinct lower(e)) into cc_list
  from (
    select st.email as e
    from staff st
    join staff_roles sr on sr.staff_id = st.staff_id
    where sr.role_name = 'smt' and st.email is not null and length(trim(st.email)) > 0
    union
    select 'sro@abc.sch.ng'
  ) x
  where lower(e) <> alert_to;

  subject := 'Behaviour alert: ' || student_name || ' — ' || coalesce(new.category, 'Negative event');
  body_html := '<p><strong>' || student_name || '</strong> has triggered a behaviour alert.</p>' ||
               '<p>' || reason || '</p>' ||
               '<p><strong>Latest event — Category:</strong> ' || coalesce(new.category, '—') || '<br/>' ||
               '<strong>Points:</strong> ' || coalesce(new.points::text, '—') || '<br/>' ||
               '<strong>Date:</strong> ' || new.event_date::text || '</p>' ||
               '<p>' || coalesce(new.description, '') || '</p>';

  perform post_inbox_notice(
    (select array_agg(p.id)
       from profiles p
       join staff st on st.staff_id = p.staff_id
      where lower(st.email) = any (array_append(coalesce(cc_list, array[]::text[]), alert_to))),
    subject,
    body_html || '<p>Student record: https://misform.work/students/' || new.student_id || '</p>',
    'behaviour_alert');

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return new;
  end if;

  perform public.queue_workspace_email(jsonb_build_object(
      'to', alert_to,
      'cc', to_jsonb(coalesce(cc_list, array[]::text[])),
      'subject', subject,
      'html', body_html || '<p><a href="https://misform.work/students/' || new.student_id || '">View student in Adorable MIS</a></p>',
      'reply_to', email_reply_to('behaviour_alert')
    )
  );

  return new;
end;
$function$;

create or replace function public.send_detention_email(p_student_id integer, p_detention_date date, p_reason text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_key text;
  v_first_name text;
  v_email text;
  v_room text;
  v_time text;
  v_day text;
  body_html text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return false;
  end if;

  select first_name, student_email into v_first_name, v_email
  from students where student_id = p_student_id;
  if v_email is null or length(trim(v_email)) = 0 then
    return false;
  end if;

  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');

  v_day := to_char(p_detention_date, 'FMDay FMDD FMMonth YYYY');

  body_html := '<p>Dear ' || coalesce(v_first_name, 'student') || ',</p>' ||
               '<p>You have a detention on <strong>' || v_day || '</strong>.</p>' ||
               '<p>Report to <strong>' || v_room || '</strong> ' || v_time || '.</p>' ||
               '<p>This detention was given for ' || p_reason || '.</p>' ||
               '<p>If you have a question about it, speak to your form tutor or houseparent before Friday.</p>' ||
               '<p>Adorable British College</p>';

  perform public.queue_workspace_email( jsonb_build_object(
      'to', v_email,
      'subject', 'Detention: ' || v_day || ', ' || v_room || ' ' || v_time,
      'html', body_html,
      'reply_to', email_reply_to('detention')
    )
  );
  return true;
end;
$function$;

create or replace function public.notify_student_of_cancelled_detention()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  r record;
  v_day text;
  v_remaining text;
  v_room text;
  v_time text;
  v_html text;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');

  for r in
    select n.student_id, n.detention_date, s.first_name, s.student_email,
           string_agg(detention_reason(n.detention_id), '; ' order by n.detention_id) as reasons
    from new_rows n
    join old_rows o on o.detention_id = n.detention_id
    join students s on s.student_id = n.student_id
    where o.status = 'scheduled' and n.status = 'cancelled'
      and not n.is_demo
      and n.detention_date >= school_today()
    group by n.student_id, n.detention_date, s.first_name, s.student_email
  loop
    if not exists (
      select 1 from detentions
      where student_id = r.student_id and detention_date = r.detention_date
        and student_notified_at is not null
    ) then
      continue;
    end if;

    v_day := to_char(r.detention_date, 'FMDay FMDD FMMonth YYYY');

    select string_agg(detention_reason(detention_id), '; ' order by detention_id) into v_remaining
    from detentions
    where student_id = r.student_id and detention_date = r.detention_date and status = 'scheduled';

    v_html := '<p>Your detention on <strong>' || v_day || '</strong> has been <strong>cancelled</strong>. ' ||
              'It had been given for ' || r.reasons || '.</p>';
    if v_remaining is null then
      v_html := v_html || '<p>You do not need to attend detention that day.</p>';
    else
      v_html := v_html || '<p>You still have a detention that day, given for ' || v_remaining ||
                '. Report to <strong>' || v_room || '</strong> ' || v_time || ' as before.</p>';
    end if;

    perform post_student_notice(r.student_id, 'Detention cancelled: ' || v_day, v_html);

    if r.student_email is not null and length(trim(r.student_email)) > 0 then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', r.student_email,
        'subject', 'Detention cancelled: ' || v_day,
        'html', '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' || v_html || '<p>Adorable British College</p>',
        'reply_to', email_reply_to('detention')
      ));
    end if;
  end loop;

  return null;
end;
$function$;

create or replace function public.send_detention_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_date date := school_today() + 1;
  v_day text := to_char(school_today() + 1, 'FMDay FMDD FMMonth YYYY');
  v_room text;
  v_time text;
  v_sent integer := 0;
  v_subject text;
  v_html text;
  v_posted boolean;
  r record;
begin
  select detention_room, detention_time into v_room, v_time from system_settings limit 1;
  v_room := coalesce(v_room, 'CG4');
  v_time := coalesce(v_time, 'after lesson 7');
  v_subject := 'Reminder - detention tomorrow: ' || v_day || ', ' || v_room || ' ' || v_time;

  for r in
    select d.student_id, s.first_name, s.student_email,
           array_agg(d.detention_id) as detention_ids,
           string_agg(detention_reason(d.detention_id), '; ' order by d.detention_id) as reasons
    from detentions d
    join students s on s.student_id = d.student_id
    where d.detention_date = v_date
      and d.status = 'scheduled'
      and d.reminded_at is null
      and not d.is_demo
    group by d.student_id, s.first_name, s.student_email
  loop
    v_html := '<p>This is a reminder that you have a detention tomorrow, <strong>' || v_day || '</strong>.</p>' ||
              '<p>Report to <strong>' || v_room || '</strong> ' || v_time || '.</p>' ||
              '<p>It was given for ' || r.reasons || '.</p>';

    v_posted := post_student_notice(r.student_id, v_subject, v_html);

    if r.student_email is not null and length(trim(r.student_email)) > 0 then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', r.student_email,
        'subject', v_subject,
        'html', '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' || v_html || '<p>Adorable British College</p>',
        'reply_to', email_reply_to('detention')
      ));
    elsif not v_posted then
      continue;
    end if;

    update detentions set reminded_at = now() where detention_id = any (r.detention_ids);
    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$function$;
