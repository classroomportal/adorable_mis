-- Migration 404: an urgent worry nobody has opened after 24 hours alerts the
-- guidance staff.
--
-- Why (the principal, 8 Oct 2026): "cover when neither the DSL nor the
-- principal opens urgent worries", then "24 hours, alert Osione". On the
-- morning of 8 Oct, 16 urgent worries from the evening before were still
-- unopened. Since migration 400 a new worry sends nothing, so without this an
-- urgent worry could sit unread.
--
--   * escalate_unopened_urgent_worries(), run every hour by the cron job
--     "worry-box-urgent-escalation", finds urgent worries still 'new' (nobody
--     has opened them: open_worry() sets 'open') 24 hours or more after they
--     were sent or typed in, and not already escalated.
--   * It sends the holders of the `guidance` role (Osione ILOEJE, migration
--     403) one inbox message and one email for that run, with the count only.
--     Like every Worry Box notice (migration 400), it carries no detail of the
--     worry: not the student, the category or the text, because inbox messages
--     and the email outbox are readable by other people.
--   * Each worry is escalated once (worries.escalated_at), so the alert isn't
--     repeated every hour. Opening the worry is what answers it; there is no
--     button. Nothing is sent in an hour with none.
--   * Not to the DSL or the principal: the principal asked for Osione only,
--     and they had asked for no Worry Box emails (migration 400).

set local formwork.change_note = 'Principal (direct)';

alter table public.worries add column if not exists escalated_at timestamptz;

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('worry_box_escalation', 'Worry Box: urgent worry not opened',
   'The email to guidance staff when an urgent worry has not been opened for 24 hours. It carries no detail of the worry.',
   null, 59, false, false, array['cs@abc.sch.ng'])
on conflict (email_kind) do nothing;

create or replace function public.escalate_unopened_urgent_worries()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_ids bigint[];
  v_count integer;
  v_profiles uuid[];
  v_emails text[];
  v_subject text;
  v_text text;
begin
  perform pg_advisory_xact_lock(hashtext('worry_box_escalation'));

  select array_agg(worry_id) into v_ids
  from worries
  where urgent and status = 'new' and escalated_at is null
    and created_at <= now() - interval '24 hours';

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    return 0;
  end if;

  select array_agg(distinct p.id) into v_profiles
  from staff_roles sr join profiles p on p.staff_id = sr.staff_id
  where sr.role_name = 'guidance';

  select array_agg(distinct lower(btrim(s.email))) into v_emails
  from staff_roles sr join staff s on s.staff_id = sr.staff_id
  where sr.role_name = 'guidance' and is_plain_email(lower(btrim(s.email)));

  v_subject := 'URGENT: ' || case when v_count = 1 then 'an urgent worry has' else v_count || ' urgent worries have' end
    || ' not been opened for 24 hours';
  v_text := case when v_count = 1
      then 'A worry a student marked urgent (they don''t feel safe, or need to talk to someone soon) has'
      else v_count || ' worries students marked urgent (they don''t feel safe, or need to talk to someone soon) have' end
    || ' been in the Worry Box for over 24 hours and nobody has opened '
    || case when v_count = 1 then 'it' else 'them' end || '. Please read '
    || case when v_count = 1 then 'it' else 'them' end || ' as soon as you can.';

  if v_profiles is not null then
    perform post_inbox_notice(v_profiles, v_subject,
      '<p>' || v_text || '</p><p>Open the Worry Box in Formwork: https://misform.work/worry-box</p>',
      'worry_box');
  end if;

  if v_emails is not null then
    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(v_emails),
      'subject', v_subject,
      'html', '<p>' || v_text || '</p><p>For the students'' privacy this email says nothing more. '
        || 'Open the Worry Box in Formwork: <a href="https://misform.work/worry-box">https://misform.work/worry-box</a></p>',
      'reply_to', email_reply_to('worry_box_escalation')));
  end if;

  update worries set escalated_at = now() where worry_id = any (v_ids);
  return v_count;
end;
$$;

revoke execute on function public.escalate_unopened_urgent_worries() from public, anon, authenticated;

select cron.schedule('worry-box-urgent-escalation', '7 * * * *', 'select public.escalate_unopened_urgent_worries()');
