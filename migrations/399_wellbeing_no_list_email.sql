-- Migration 399: no wellbeing email at all; the Wellbeing page is the list.
--
-- Why (the principal, 7 Oct 2026, the evening 398 went in): "I don't think we
-- can cope with the emails. The list on the tile should be sufficient. I need
-- to share this list out somehow so perhaps this is best done in a meeting
-- with counselling and house parents."
--
-- The cron job from migration 398 is removed before it first ran (it was
-- unscheduled through the connector at 21:10 Lagos on 7 Oct, ahead of its
-- 21:50 run), so no list email was ever sent. notify_wellbeing_flag() stays
-- empty (398), so a check-in sends nothing either. send_wellbeing_list() is
-- kept but no longer run. The Wellbeing page gains a printable meeting sheet
-- (one table per house, names and areas of concern only, blank "who will
-- talk to them" and notes columns) for the follow-up meeting.

set local formwork.change_note = 'Principal (direct)';

do $$
begin
  perform cron.unschedule('wellbeing-end-of-prep');
exception when others then
  null;  -- already removed
end $$;

-- The principal also asked (7 Oct 2026) for the messages already sent to be
-- deleted: 172 "Wellbeing check-in needs a look" inbox notices (one each for
-- cs@ and principal@, no names in them) and the 2 hourly emails' copies in
-- the outbox. The connector holds back deletes, so this part is run in the
-- SQL editor. The emails already delivered to Gmail are deleted there.
delete from public.message_recipients
where message_id in (select id from public.messages
                     where target_type = 'automatic' and target_value = 'wellbeing'
                       and subject = 'Wellbeing check-in needs a look');
delete from public.messages
where target_type = 'automatic' and target_value = 'wellbeing'
  and subject = 'Wellbeing check-in needs a look';
delete from public.email_outbox where subject = 'Wellbeing check-ins need a look';
