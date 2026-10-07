-- Migration 400: the Worry Box sends no emails or inbox messages.
--
-- Why (the principal, 7 Oct 2026): "I am still getting worry box emails",
-- after the wellbeing messages were stopped (398–399) because "the list on
-- the tile should be sufficient". On the first day 43 worries each sent the
-- DSL and the principal an email and an inbox message (16 marked urgent).
--
-- notify_new_worry() now does nothing (send_worry() still calls it). New and
-- urgent worries show on the Worry Box tile on their dashboard and on
-- /worry-box. Replies to a student (add_worry_note() with to_student) still
-- tell the student in their inbox.
--
-- The messages already sent are deleted in the SQL editor (the connector
-- holds back deletes): the "New worry in the Worry Box" and "URGENT: new
-- worry in the Worry Box" inbox notices and their email outbox copies. The
-- emails already delivered to Gmail are deleted there.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.notify_new_worry(p_urgent boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Since migration 400 a new worry sends nothing; the DSL and the principal
  -- see new and urgent worries on the Worry Box tile and page.
  return;
end;
$$;

revoke execute on function public.notify_new_worry(boolean) from public, anon, authenticated;

-- Run in the SQL editor:
delete from public.message_recipients
where message_id in (select id from public.messages
                     where target_type = 'automatic' and target_value = 'worry_box'
                       and subject in ('New worry in the Worry Box', 'URGENT: new worry in the Worry Box'));
delete from public.messages
where target_type = 'automatic' and target_value = 'worry_box'
  and subject in ('New worry in the Worry Box', 'URGENT: new worry in the Worry Box');
delete from public.email_outbox
where subject in ('New worry in the Worry Box', 'URGENT: new worry in the Worry Box');
