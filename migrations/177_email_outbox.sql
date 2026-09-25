-- Migration 177: send email through a throttled outbox, and record what was
-- actually delivered.
--
-- Why: every email function (welcome letters, send_message, detentions,
-- behaviour alerts) called net.http_post straight at the
-- send-workspace-email edge function and never looked at the reply. On
-- 25 Sep 2026 that failed twice:
--   * first, the deployed function silently dropped all non-school
--     recipients but answered ok, so 130 parent letters were "sent" and none
--     arrived;
--   * then, resending 61 Year 12 letters fired 61 simultaneous SMTP logins
--     at Gmail, which refused 47 ("421 4.3.0 Temporary System Problem") and
--     let 11 more time out at pg_net's 5-second default. Only 3 were
--     accepted, yet the page again recorded all 61 as sent.
--
-- Now:
--   email_outbox                 one row per email: the JSON body for the
--                                edge function, its status
--                                (queued/sending/sent/failed), attempts,
--                                the last error, and pg_net's request id.
--   queue_workspace_email(body)  what the email functions call instead of
--                                net.http_post. Just inserts a row.
--   process_email_outbox()       pg_cron, every 15 seconds. First settles
--                                rows in flight by reading their reply from
--                                net._http_response (2xx -> sent; anything
--                                else -> retried with a growing delay, failed
--                                after 6 tries). Then sends up to 3 more, so
--                                no more than 3 are ever in flight — Gmail
--                                accepted 3 at once and refused the rest.
--                                60-second timeout instead of 5, so a slow
--                                SMTP handshake isn't mistaken for a failure
--                                (and resent, duplicating the email).
--
-- The seven existing email functions are rewritten in place, below, to call
-- queue_workspace_email() with the same body they passed to net.http_post —
-- nothing else in them changes. Done by editing each function's current
-- definition rather than restating it here, because several were created
-- directly against the live database (see sql/CURRENT_SCHEMA.md) and
-- restating them risks reverting a change nobody committed. The block fails
-- if any function doesn't contain exactly one call to rewrite.
--
-- Roughly 12 emails a minute: a full 1,000-parent welcome run takes about
-- an hour and a half, which is fine for letters and far better than most of
-- them never arriving.

create table public.email_outbox (
  email_id bigint generated always as identity primary key,
  payload jsonb not null,                -- body for send-workspace-email: to, subject, html/text
  recipient text,                        -- for reading the table; the payload is what's sent
  subject text,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  request_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index email_outbox_pending_idx on public.email_outbox (next_attempt_at, email_id) where status = 'queued';
create index email_outbox_sending_idx on public.email_outbox (request_id) where status = 'sending';

alter table public.email_outbox enable row level security;
grant select on public.email_outbox to authenticated;

create policy admin_read_email_outbox on public.email_outbox
  for select using (is_admin());

create or replace function public.queue_workspace_email(p_body jsonb)
returns bigint
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into email_outbox (payload, recipient, subject)
  values (
    p_body,
    case jsonb_typeof(p_body -> 'to')
      when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(p_body -> 'to') x)
      else p_body ->> 'to'
    end,
    p_body ->> 'subject'
  )
  returning email_id;
$$;

revoke execute on function public.queue_workspace_email(jsonb) from public, anon, authenticated;

create or replace function public.process_email_outbox()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  max_in_flight constant integer := 3;
  max_attempts constant integer := 6;
  rec record;
  v_free integer;
  v_request bigint;
begin
  -- 1. Settle emails whose reply has come back.
  for rec in
    select o.email_id, o.attempts, r.status_code, r.timed_out,
           coalesce(r.error_msg, left(r.content, 500)) as detail
    from email_outbox o
    join net._http_response r on r.id = o.request_id
    where o.status = 'sending'
  loop
    if rec.status_code between 200 and 299 then
      update email_outbox set status = 'sent', sent_at = now(), last_error = null
      where email_id = rec.email_id;
    else
      update email_outbox
         set status = case when rec.attempts >= max_attempts then 'failed' else 'queued' end,
             next_attempt_at = now() + make_interval(mins => rec.attempts),
             last_error = coalesce(rec.status_code::text, case when rec.timed_out then 'timeout' end, 'error')
                          || ': ' || coalesce(rec.detail, '')
       where email_id = rec.email_id;
    end if;
  end loop;

  -- A reply pg_net has already discarded (it keeps them ~6 hours) can
  -- never settle; retry rather than leave the email stuck.
  update email_outbox
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         last_error = 'no reply recorded'
   where status = 'sending' and next_attempt_at < now() - interval '10 minutes';

  -- 2. Send more, keeping at most max_in_flight outstanding.
  select max_in_flight - count(*) into v_free from email_outbox where status = 'sending';
  if v_free <= 0 then
    return;
  end if;

  for rec in
    select email_id, payload from email_outbox
    where status = 'queued' and next_attempt_at <= now()
    order by next_attempt_at, email_id
    limit v_free
    for update skip locked
  loop
    select net.http_post(
      url := 'https://drjtcegtucovhbyfdpbx.supabase.co/functions/v1/send-workspace-email',
      body := rec.payload,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(public.send_workspace_email_key(), ''),
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 60000
    ) into v_request;

    update email_outbox
       set status = 'sending', request_id = v_request, attempts = attempts + 1, next_attempt_at = now()
     where email_id = rec.email_id;
  end loop;
end;
$$;

revoke execute on function public.process_email_outbox() from public, anon, authenticated;

-- Point every email function at the outbox.
do $$
declare
  fn text;
  def text;
  start_pos integer;
  body_pos integer;
begin
  foreach fn in array array[
    'notify_pastoral_on_negative_behaviour', 'send_staff_welcome_email', 'send_student_welcome_email',
    'send_parent_welcome_email', 'send_message', 'parent_welcome_email_post', 'send_detention_email'
  ] loop
    select pg_get_functiondef(p.oid) into def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    if def is null then
      raise exception 'email_outbox: function % not found', fn;
    end if;
    if (length(def) - length(replace(def, 'net.http_post(', ''))) / length('net.http_post(') <> 1
       or position('send-workspace-email' in def) = 0 then
      raise exception 'email_outbox: % does not contain exactly one send-workspace-email call', fn;
    end if;

    -- net.http_post(url := ..., headers := ..., body := X) -> public.queue_workspace_email(X):
    -- the closing parenthesis of http_post becomes queue_workspace_email's.
    start_pos := position('net.http_post(' in def);
    body_pos := start_pos + position('body :=' in substr(def, start_pos)) - 1;
    if body_pos < start_pos then
      raise exception 'email_outbox: no body := in %', fn;
    end if;
    def := substr(def, 1, start_pos - 1)
        || 'public.queue_workspace_email('
        || substr(def, body_pos + length('body :='));
    execute def;
  end loop;
end $$;

select cron.schedule('process-email-outbox', '15 seconds', 'select public.process_email_outbox();');
