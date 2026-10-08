-- Migration 408: the Worry Box's Facilities list emailed to the admin
-- manager every day at 4 pm.
--
-- Why (the principal, 8 Oct 2026): "Facilities list should be sent each day
-- to admin manager each day at 4". Facilities worries (broken equipment,
-- rooms, food, water, toilets; the 'equipment' category, migration 407) need
-- fixing by the admin manager, Paul IMO (admin.manager@), who can't open the
-- Worry Box: only the DSL, the principal and guidance staff can.
--
--   * send_facilities_worry_list(), run by the cron job
--     "worry-box-facilities-daily" at 16:00 Lagos (15:00 UTC) every day,
--     emails every Facilities worry that isn't closed, oldest first, marking
--     the ones that came in during the last 24 hours as new. Nothing is sent
--     on a day with none.
--   * What the worry says, the date and its status only: never the student's
--     name, year or house. The admin manager needs to know what to fix, not
--     who said it. A worry about something personal that a student filed
--     under Facilities would go too, so the readers should move such a worry
--     to the right heading ("Move to", migration 407) when they see one.
--   * The email is queued with 'private': true, so admins and the office
--     can't read it in email_outbox (migration 398).
--   * Who gets it is the table worry_facilities_recipients (seeded with
--     admin.manager@). It has RLS and no grants, so it is changed only in a
--     migration or the SQL editor: system_settings is editable by every
--     admin, and an admin who isn't a Worry Box reader mustn't be able to
--     send the list to themselves. Replies go
--     through the 'worry_box_facilities' reply route (principal@ as seeded,
--     changeable at /admin/email-replies).
--   * Sending doesn't open a worry or change it: the Worry Box stays the
--     record.

set local formwork.change_note = 'Principal (direct)';

create table public.worry_facilities_recipients (
  email text primary key check (email = lower(btrim(email)) and is_plain_email(email)),
  note text,
  added_at timestamptz not null default now()
);

alter table public.worry_facilities_recipients enable row level security;
-- No grants and no policies: changed only in a migration or the SQL editor.

insert into public.worry_facilities_recipients (email, note)
values ('admin.manager@abc.sch.ng', 'Paul IMO, admin manager (the principal, 8 Oct 2026)')
on conflict (email) do nothing;

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('worry_box_facilities', 'Worry Box: daily facilities list',
   'The 4 pm email to the admin manager listing Facilities worries that are not closed. It carries what the worry says, never the student.',
   null, 60, false, false, array['principal@abc.sch.ng'])
on conflict (email_kind) do nothing;

create or replace function public.send_facilities_worry_list()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_emails text[];
  v_count integer;
  v_new integer;
  v_rows text;
begin
  select array_agg(email order by email) into v_emails from worry_facilities_recipients;
  if v_emails is null then
    return 0;
  end if;

  select count(*),
         count(*) filter (where created_at > now() - interval '24 hours'),
         string_agg(
           '<tr><td style="border:1px solid #999;padding:4px 6px;vertical-align:top;white-space:nowrap">'
             || to_char(case when source = 'paper' then received_on::timestamp
                             else created_at at time zone 'Africa/Lagos' end, 'DD Mon YYYY')
             || case when created_at > now() - interval '24 hours' then '<br><strong>New</strong>' else '' end
             || '</td><td style="border:1px solid #999;padding:4px 6px;vertical-align:top;white-space:pre-wrap">'
             || html_escape(details)
             || '</td><td style="border:1px solid #999;padding:4px 6px;vertical-align:top">'
             || case when urgent then '<strong>Urgent</strong><br>' else '' end
             || case status when 'new' then 'Not yet read' else 'Being looked at' end
             || '</td></tr>',
           '' order by created_at)
    into v_count, v_new, v_rows
  from worries
  where category = 'equipment' and status <> 'closed';

  if v_count = 0 then
    return 0;
  end if;

  perform queue_workspace_email(jsonb_build_object(
    'to', to_jsonb(v_emails),
    'subject', 'Worry Box: facilities list, ' || to_char(school_today(), 'DD Mon YYYY')
      || ' (' || v_count || case when v_count = 1 then ' item' else ' items' end
      || case when v_new > 0 then ', ' || v_new || ' new' else '' end || ')',
    'html', '<p>Facilities worries from the students'' Worry Box that are not closed yet, oldest first. '
      || '"New" means it came in during the last 24 hours. Students'' names are not included.</p>'
      || '<table style="border-collapse:collapse;font-size:14px">'
      || '<tr><th style="border:1px solid #999;padding:4px 6px;text-align:left">Received</th>'
      || '<th style="border:1px solid #999;padding:4px 6px;text-align:left">What the student wrote</th>'
      || '<th style="border:1px solid #999;padding:4px 6px;text-align:left">Status</th></tr>'
      || v_rows || '</table>'
      || '<p>Reply to this email to say what has been done, so the worry can be closed.</p>',
    'reply_to', email_reply_to('worry_box_facilities'),
    'private', true));

  return v_count;
end;
$$;

revoke execute on function public.send_facilities_worry_list() from public, anon, authenticated;

select cron.schedule('worry-box-facilities-daily', '0 15 * * *', 'select public.send_facilities_worry_list()');
