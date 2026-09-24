-- 167_email_student_on_detention.sql
-- Booking a detention used to tell nobody. handle_negative_behaviour() put a
-- row on /detention and that was all; the student found out only if a member
-- of staff told them, and the detention itself didn't record where or when
-- to go. The principal wants the student emailed, telling them where and
-- when to report.
--
-- Where/when: stored once in system_settings (detention_room,
-- detention_time), since it is the same every Friday. Defaults are the
-- school's current arrangement, CG4 after lesson 7. There's no admin screen
-- for these yet; change them with an update on system_settings.
--
-- Who: the student's own student_email only. send-workspace-email already
-- drops anything outside @abc.sch.ng (the principal's no-parent-email policy),
-- and this deliberately doesn't try to reach parents or tutors.
--
-- One email per student per Friday. A student can get two or three detention
-- rows for the same Friday (a -5 event and the weekly total, say), so
-- detentions.student_notified_at marks the row that sent the email and later
-- rows for that student and date stay quiet. Also skipped: training/demo
-- rows, anything not 'scheduled', a Friday that has already passed, and a
-- student with no email.
--
-- Unlike the older email functions, the key for calling send-workspace-email
-- is not written into the function body: it is read from Supabase Vault
-- (secret name 'send_workspace_email_key', the project's anon key), so it
-- isn't copied into yet another migration. If that secret is missing, no
-- email is sent and student_notified_at stays null.
--
-- BEFORE INSERT so the trigger can stamp student_notified_at on the row
-- itself; pg_net only sends the request once the transaction commits, so a
-- rolled-back insert emails nobody.

alter table system_settings
  add column if not exists detention_room text not null default 'CG4',
  add column if not exists detention_time text not null default 'after lesson 7';

alter table detentions
  add column if not exists student_notified_at timestamptz;

-- Sends the detention email for one student and Friday. Split out from the
-- trigger so a detention booked before this migration can be emailed with
-- exactly the same wording (select send_detention_email(...) from SQL).
-- Returns whether an email was queued.
create or replace function send_detention_email(p_student_id integer, p_detention_date date, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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

  perform net.http_post(
    url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'to', v_email,
      'subject', 'Detention: ' || v_day || ', ' || v_room || ' ' || v_time,
      'html', body_html
    )
  );
  return true;
end;
$$;

revoke execute on function public.send_detention_email(integer, date, text) from public, anon, authenticated;

create or replace function notify_student_of_detention()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_reason text;
begin
  if new.is_demo or new.status <> 'scheduled' or new.detention_date < school_today() then
    return new;
  end if;

  if exists (
    select 1 from detentions
    where student_id = new.student_id
      and detention_date = new.detention_date
      and student_notified_at is not null
  ) then
    return new;
  end if;

  if new.behaviour_event_id is not null then
    select 'a serious behaviour event: ' || coalesce(category, 'negative event') || ' (' || points || ' points) on ' || to_char(event_date, 'FMDay FMDD FMMonth')
      into v_reason
    from behaviour_events where event_id = new.behaviour_event_id;
  end if;
  v_reason := coalesce(v_reason, 'reaching 10 or more negative behaviour points this week');

  if send_detention_email(new.student_id, new.detention_date, v_reason) then
    new.student_notified_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_student_of_detention() from public, anon, authenticated;

drop trigger if exists trg_notify_student_of_detention on detentions;
create trigger trg_notify_student_of_detention
  before insert on detentions
  for each row execute function notify_student_of_detention();
