-- Migration 262: detention and certificate rules editable on Lookups.
--
-- Why: the principal asked (30 Sept 2026) for the conditions for
-- certificates and detentions to be editable at /admin/lookups. They were
-- written into the code:
--   * a detention for one negative event of -5 points or worse, and for a
--     Saturday-to-Friday negative total of -10 or worse
--     (handle_negative_behaviour(), and again in edit_behaviour_event()
--     when an event's category is changed);
--   * the behaviour alert email for one event of -5 or worse, or a weekly
--     total of -8 (notify_pastoral_on_negative_behaviour());
--   * Bronze / Silver / Gold certificates at 100 / 200 / 500 cumulative
--     points, in the page app/certificates/page.js.
-- The detention room and time were already settings (system_settings), but
-- no page edited them.
--
-- Now:
--   * behaviour_rules (one row) holds the three thresholds and the
--     functions read them. The seeded values are today's, so nothing
--     changes until someone edits them. Written only through
--     set_behaviour_rules(), which checks the caller has Lookups and also
--     saves the detention room and time. Every change to the thresholds is
--     logged in change_history under 'behaviour'.
--   * certificate_levels holds the certificate levels (name and points),
--     edited on Lookups by the same people; logged under 'behaviour'.
--     certificates_awarded gains level_name, so a certificate once given
--     stays given even if its points are changed later (none had been
--     awarded at the time of writing).
--   * Not changed: the separate rule that a -5 event is "serious" (needs an
--     explanation, is reviewed before parents see it) stays at -5; it isn't
--     a detention or certificate condition.

set local formwork.change_note = 'Principal (direct)';

-- 1. Behaviour rules ------------------------------------------------------------

create table if not exists public.behaviour_rules (
  id boolean primary key default true check (id),
  detention_single_event_points integer not null default -5 check (detention_single_event_points < 0),
  detention_weekly_total_points integer not null default -10 check (detention_weekly_total_points < 0),
  alert_weekly_total_points integer not null default -8 check (alert_weekly_total_points < 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

comment on table public.behaviour_rules is
  'Detention and behaviour-alert thresholds (migration 262), edited at /admin/lookups through set_behaviour_rules(). Read by handle_negative_behaviour(), edit_behaviour_event() and notify_pastoral_on_negative_behaviour().';

insert into public.behaviour_rules (id) values (true) on conflict (id) do nothing;

alter table public.behaviour_rules enable row level security;
grant select on public.behaviour_rules to authenticated;

create policy "Behaviour rules readable by all authenticated"
  on public.behaviour_rules for select to authenticated using (true);

create trigger trg_log_change after update on public.behaviour_rules
  for each row execute function public.log_change('behaviour', 'id');

-- 2. Certificate levels -------------------------------------------------------------

create table if not exists public.certificate_levels (
  level_id integer generated always as identity primary key,
  name text not null unique check (btrim(name) <> ''),
  points integer not null unique check (points > 0)
);

comment on table public.certificate_levels is
  'Certificate levels and the cumulative behaviour points that earn them (migration 262), edited at /admin/lookups.';

insert into public.certificate_levels (name, points) values
  ('Bronze', 100), ('Silver', 200), ('Gold', 500)
on conflict (name) do nothing;

alter table public.certificate_levels enable row level security;
grant select, insert, update, delete on public.certificate_levels to authenticated;

create policy "Certificate levels readable by all authenticated"
  on public.certificate_levels for select to authenticated using (true);
create policy "Certificate levels edited on Lookups"
  on public.certificate_levels for all to authenticated
  using (has_resource_access('/admin/lookups'))
  with check (has_resource_access('/admin/lookups'));

create trigger trg_log_change after insert or update or delete on public.certificate_levels
  for each row execute function public.log_change('behaviour', 'level_id');

alter table public.certificates_awarded add column if not exists level_name text;

-- 3. Saving the rules --------------------------------------------------------------

create or replace function public.set_behaviour_rules(
  p_detention_single_event_points integer,
  p_detention_weekly_total_points integer,
  p_alert_weekly_total_points integer,
  p_detention_room text,
  p_detention_time text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change detention rules.';
  end if;
  if p_detention_single_event_points >= 0 or p_detention_weekly_total_points >= 0 or p_alert_weekly_total_points >= 0 then
    raise exception 'Detention and alert thresholds are negative points (e.g. -5).';
  end if;

  update behaviour_rules set
    detention_single_event_points = p_detention_single_event_points,
    detention_weekly_total_points = p_detention_weekly_total_points,
    alert_weekly_total_points = p_alert_weekly_total_points,
    updated_by = auth.uid(),
    updated_at = now()
  where id;

  update system_settings set
    detention_room = nullif(btrim(p_detention_room), ''),
    detention_time = nullif(btrim(p_detention_time), '');
end;
$$;

-- 4. The functions read the rules -----------------------------------------------------

create or replace function public.handle_negative_behaviour()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  week_start date;
  week_end date;
  week_total integer;
  detention_friday date;
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;

  if new.points <= -3 then
    perform pg_notify('behaviour_escalation', json_build_object(
      'event_id', new.event_id,
      'student_id', new.student_id,
      'points', new.points
    )::text);
  end if;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;
  detention_friday := week_start + 6;

  if new.points <= r.detention_single_event_points then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, new.event_id, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions where behaviour_event_id = new.event_id
    );
  end if;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if week_total <= r.detention_weekly_total_points then
    insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
    select new.student_id, null, detention_friday, 'scheduled', new.is_demo
    where not exists (
      select 1 from detentions
      where student_id = new.student_id and detention_date = detention_friday and behaviour_event_id is null
    );
  end if;

  return new;
end;
$$;

create or replace function public.notify_pastoral_on_negative_behaviour()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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
  r behaviour_rules;
begin
  if new.is_demo then
    return new;
  end if;
  select * into r from behaviour_rules where id;

  week_start := new.event_date - (((extract(dow from new.event_date)::int - 6 + 7) % 7));
  week_end := week_start + 6;

  select coalesce(sum(points), 0) into week_total
  from behaviour_events
  where student_id = new.student_id and type = 'negative'
    and event_date between week_start and week_end;

  if new.points <= r.detention_single_event_points then
    reason := 'A single severe event was logged (' || new.points || ' points).';
  elsif week_total <= r.alert_weekly_total_points then
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
$$;

create or replace function public.edit_behaviour_event(p_event_id integer, p_category text, p_description text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event behaviour_events%rowtype;
  v_my_staff_id integer;
  v_category text := coalesce(nullif(btrim(p_category), ''), null);
  v_description text := nullif(btrim(p_description), '');
  v_points integer;
  v_week_start date;
  v_friday date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_week_total integer;
  v_added integer := 0;
  v_cancelled integer := 0;
  v_n integer;
  r behaviour_rules;
begin
  select * into r from behaviour_rules where id;
  select * into v_event from behaviour_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Behaviour event % not found.', p_event_id;
  end if;
  if v_event.voided_at is not null then
    raise exception 'This event was withdrawn on appeal and can no longer be edited.';
  end if;

  select staff_id into v_my_staff_id from profiles where id = auth.uid();
  if not (is_pastoral_or_smt()
          or has_staff_role(array['school_office'])
          or (v_my_staff_id is not null and v_my_staff_id = v_event.staff_id)) then
    raise exception 'Only the member of staff who logged this event, pastoral/SMT or the school office can edit it.'
      using errcode = 'insufficient_privilege';
  end if;

  v_category := coalesce(v_category, v_event.category);
  select default_points into v_points
  from behaviour_categories where name = v_category and type = v_event.type;
  if v_points is null then
    raise exception 'Choose a % behaviour category.', v_event.type;
  end if;
  if v_points <= -5 and v_description is null then
    raise exception 'A serious event (-5 points) needs an explanation of what happened.';
  end if;

  if v_category is not distinct from v_event.category
     and v_description is not distinct from v_event.description then
    return jsonb_build_object('changed', false, 'detentions_added', 0, 'detentions_cancelled', 0);
  end if;

  update behaviour_events
  set category = v_category, points = v_points, description = v_description
  where event_id = p_event_id;

  insert into behaviour_event_audit (event_id, changed_by, old_values, new_values)
  values (p_event_id, auth.uid(),
          jsonb_build_object('category', v_event.category, 'points', v_event.points, 'description', v_event.description),
          jsonb_build_object('category', v_category, 'points', v_points, 'description', v_description));

  if v_event.type = 'negative' and v_points is distinct from v_event.points then
    v_week_start := v_event.event_date - ((extract(dow from v_event.event_date)::int - 6 + 7) % 7);
    v_friday := v_week_start + 6;

    if v_points <= r.detention_single_event_points then
      if v_friday >= v_today then
        update detentions set status = 'scheduled'
        where behaviour_event_id = p_event_id and status = 'cancelled';
        get diagnostics v_n = row_count;
        if v_n = 0 and not exists (select 1 from detentions where behaviour_event_id = p_event_id) then
          insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
          values (v_event.student_id, p_event_id, v_friday, 'scheduled', v_event.is_demo);
          v_n := 1;
        end if;
        v_added := v_added + v_n;
      end if;
    else
      update detentions set status = 'cancelled'
      where behaviour_event_id = p_event_id and status = 'scheduled';
      get diagnostics v_n = row_count;
      v_cancelled := v_cancelled + v_n;
    end if;

    select coalesce(sum(points), 0) into v_week_total
    from behaviour_events
    where student_id = v_event.student_id and type = 'negative' and voided_at is null
      and event_date between v_week_start and v_friday;

    if v_week_total <= r.detention_weekly_total_points then
      if v_friday >= v_today then
        update detentions set status = 'scheduled'
        where student_id = v_event.student_id and detention_date = v_friday
          and behaviour_event_id is null and status = 'cancelled';
        get diagnostics v_n = row_count;
        if v_n = 0 and not exists (
          select 1 from detentions
          where student_id = v_event.student_id and detention_date = v_friday and behaviour_event_id is null
        ) then
          insert into detentions (student_id, behaviour_event_id, detention_date, status, is_demo)
          values (v_event.student_id, null, v_friday, 'scheduled', v_event.is_demo);
          v_n := 1;
        end if;
        v_added := v_added + v_n;
      end if;
    else
      update detentions set status = 'cancelled'
      where student_id = v_event.student_id and detention_date = v_friday
        and behaviour_event_id is null and status = 'scheduled';
      get diagnostics v_n = row_count;
      v_cancelled := v_cancelled + v_n;
    end if;
  end if;

  return jsonb_build_object(
    'changed', true,
    'points', v_points,
    'detention_date', v_friday,
    'detentions_added', v_added,
    'detentions_cancelled', v_cancelled
  );
end;
$$;
