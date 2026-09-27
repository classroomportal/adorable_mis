-- 202_behaviour_alert_recipients_and_email_log.sql
--
-- Two changes to automatic email.
--
-- 1. Serious behaviour alerts went to every SMT member and every
--    houseparent - 16 people for each alert. The principal asked for them to
--    go to cs@abc.sch.ng, with SMT and SRO@abc.sch.ng copied in, and to no
--    one else. The trigger conditions are unchanged (a single event of -5 or
--    worse, or a weekly total of -8 or worse). send-workspace-email accepts
--    `cc` from this change on (deployed before this migration, so no copy is
--    silently dropped); queue_workspace_email now records cc'd addresses in
--    email_outbox.recipient too, so Sent Messages shows who was copied.
--
-- 2. Sent Messages lists email_outbox, and the page wants each email sorted
--    by who it went to (parents, staff, students) and grouped by kind so a
--    batch like the 294 parent welcome emails reads as one expandable line.
--    Who an address belongs to needs staff, students and parents looked up,
--    so email_log() does that server side for the same staff who can read
--    the outbox, returning only the columns they are allowed (migration 201:
--    never the body, which can hold a parent's initial password). The kind
--    is the subject up to its first colon ("Detention", "Behaviour alert",
--    "Introducing Formwork"); a subject without one is its own group.

create or replace function public.queue_workspace_email(p_body jsonb)
returns bigint
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  insert into email_outbox (payload, recipient, subject)
  values (
    p_body,
    case jsonb_typeof(p_body -> 'to')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p_body -> 'to') x)
      else p_body ->> 'to'
    end
    || coalesce(' (cc: ' || case jsonb_typeof(p_body -> 'cc')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p_body -> 'cc') x)
      else p_body ->> 'cc'
    end || ')', ''),
    p_body ->> 'subject'
  )
  returning email_id;
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

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';
  if v_key is null then
    return new;
  end if;

  select first_name || ' ' || last_name into student_name from students where student_id = new.student_id;

  -- SMT and the SRO, copied in; never the main recipient twice.
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
               '<p>' || coalesce(new.description, '') || '</p>' ||
               '<p><a href="https://misform.work/students/' || new.student_id || '">View student in Adorable MIS</a></p>';

  perform public.queue_workspace_email(jsonb_build_object(
      'to', alert_to,
      'cc', to_jsonb(coalesce(cc_list, array[]::text[])),
      'subject', subject,
      'html', body_html
    )
  );

  return new;
end;
$function$;

create or replace function public.email_log(p_limit integer default 2000)
returns table (
  email_id bigint, recipient text, subject text, status text, attempts integer,
  last_error text, created_at timestamptz, sent_at timestamptz, audience text, kind text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select o.email_id, o.recipient, o.subject, o.status, o.attempts, o.last_error, o.created_at, o.sent_at,
         case
           when exists (select 1 from staff s where lower(s.email) = a.addr) then 'staff'
           when exists (select 1 from students s where lower(s.student_email) = a.addr) then 'students'
           when exists (select 1 from parents p where lower(p.email) = a.addr) then 'parents'
           else 'other'
         end as audience,
         case when position(':' in coalesce(o.subject, '')) > 0
           then split_part(o.subject, ':', 1)
           else coalesce(o.subject, '(no subject)')
         end as kind
  from email_outbox o
  cross join lateral (
    select lower(trim(split_part(split_part(coalesce(o.recipient, ''), ',', 1), ' (cc:', 1))) as addr
  ) a
  where is_admin() or user_has_staff_role(array['smt', 'pastoral', 'school_office'])
  order by o.created_at desc
  limit p_limit;
$function$;

revoke execute on function public.email_log(integer) from public, anon;
grant execute on function public.email_log(integer) to authenticated;
