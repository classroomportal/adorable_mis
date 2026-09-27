-- 200_detention_cancelled_email.sql
--
-- Students are emailed when a detention is set and reminded the evening
-- before (migrations 177, 199), but nothing told them when one was cancelled
-- - whether by an upheld appeal (migration 197) or by staff choosing
-- "cancelled" on /detention - so a student could still turn up, or keep
-- worrying about it.
--
-- A statement-level trigger on detentions emails the student when a
-- detention goes from 'scheduled' to 'cancelled'. It works per statement so
-- that one change covering several detentions (/detention updates a
-- student's rows for a Friday together) sends one email per student and
-- Friday, not one per row. If the student still has a scheduled detention
-- that day, the email says so and why, so a partial cancellation isn't read
-- as "no detention".
--
-- Only students who were told about the detention are emailed (some
-- detention of theirs that Friday has student_notified_at), and only for
-- today or later: there is nothing to cancel for a Friday that has passed.
-- Demo rows are skipped.
--
-- void_event_on_upheld_appeal() is rewritten to cancel the event's own
-- detention and the weekly one in a single statement, so an appeal that
-- clears both sends one email rather than two. Its behaviour is otherwise as
-- migration 197 left it.

create or replace function public.detention_reason(p_detention_id integer)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select case when d.behaviour_event_id is null
    then 'reaching 10 or more negative behaviour points this week'
    else 'a serious behaviour event: ' || coalesce(e.category, 'negative event')
         || ' on ' || to_char(e.event_date, 'FMDay FMDD FMMonth')
  end
  from detentions d
  left join behaviour_events e on e.event_id = d.behaviour_event_id
  where d.detention_id = p_detention_id;
$function$;

revoke execute on function public.detention_reason(integer) from public, anon, authenticated;

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
  body_html text;
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
    if r.student_email is null or length(trim(r.student_email)) = 0 then
      continue;
    end if;
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

    body_html := '<p>Dear ' || coalesce(r.first_name, 'student') || ',</p>' ||
                 '<p>Your detention on <strong>' || v_day || '</strong> has been <strong>cancelled</strong>. ' ||
                 'It had been given for ' || r.reasons || '.</p>';
    if v_remaining is null then
      body_html := body_html || '<p>You do not need to attend detention that day.</p>';
    else
      body_html := body_html || '<p>You still have a detention that day, given for ' || v_remaining ||
                   '. Report to <strong>' || v_room || '</strong> ' || v_time || ' as before.</p>';
    end if;
    body_html := body_html || '<p>Adorable British College</p>';

    perform public.queue_workspace_email(jsonb_build_object(
      'to', r.student_email,
      'subject', 'Detention cancelled: ' || v_day,
      'html', body_html
    ));
  end loop;

  return null;
end;
$function$;

create trigger trg_notify_student_of_cancelled_detention
  after update on public.detentions
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.notify_student_of_cancelled_detention();

create or replace function public.void_event_on_upheld_appeal()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event behaviour_events%rowtype;
  v_week_start date;
  v_week_total integer;
begin
  if new.status = 'upheld' and (old.status is distinct from 'upheld') then
    update behaviour_events
    set points = 0,
        voided_at = coalesce(new.reviewed_at, now())
    where event_id = new.event_id
    returning * into v_event;

    if v_event.event_id is not null then
      v_week_start := v_event.event_date - (((extract(dow from v_event.event_date)::int - 6 + 7) % 7));

      select coalesce(sum(points), 0) into v_week_total
      from behaviour_events
      where student_id = v_event.student_id and type = 'negative' and voided_at is null
        and event_date between v_week_start and v_week_start + 6;

      update detentions set status = 'cancelled'
      where status = 'scheduled'
        and (
          behaviour_event_id = v_event.event_id
          or (v_week_total > -10
              and student_id = v_event.student_id
              and detention_date = v_week_start + 6
              and behaviour_event_id is null)
        );
    end if;
  end if;
  return new;
end;
$function$;
