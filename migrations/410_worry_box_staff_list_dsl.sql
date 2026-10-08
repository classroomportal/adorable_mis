-- Migration 410: worries about a member of staff emailed to the DSL every day
-- at 4.15 pm.
--
-- Why (the principal, 8 Oct 2026): "I need a list of all a member of staff to
-- go dsl", then "Email dsl 1615", not-closed only. The "A member of staff"
-- category ('staff') is the one a DSL must follow up as a possible concern
-- about an adult.
--
--   * send_staff_worry_list(), run by the cron job "worry-box-staff-daily" at
--     16:15 Lagos (15:15 UTC) every day, emails every 'staff' worry that isn't
--     closed, oldest first, marking the last 24 hours' as new. Nothing is sent
--     on a day with none.
--   * Unlike the Facilities list (migration 408) it carries the student's
--     name, year and house: the DSL already reads every worry with the name.
--   * It goes to the holders of the `dsl` role (cs@ today), found at send
--     time, so it follows the role, which only the principal gives or removes
--     (migration 405).
--   * Queued with 'private': true, so admins and the office can't read it in
--     email_outbox (migration 398). Replies go through the reply route
--     'worry_box_staff' (principal@ as seeded, the ADSL).
--   * Sending doesn't open or change a worry.

set local formwork.change_note = 'Principal (direct)';

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('worry_box_staff', 'Worry Box: daily list of worries about staff',
   'The 4.15 pm email to the DSL listing worries about a member of staff that are not closed, with the students'' names.',
   null, 61, false, false, array['principal@abc.sch.ng'])
on conflict (email_kind) do nothing;

create or replace function public.send_staff_worry_list()
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
  c constant text := 'border:1px solid #999;padding:4px 6px;vertical-align:top';
begin
  select array_agg(distinct lower(btrim(s.email))) into v_emails
  from staff_roles sr join staff s on s.staff_id = sr.staff_id
  where sr.role_name = 'dsl' and is_plain_email(lower(btrim(s.email)));
  if v_emails is null then
    return 0;
  end if;

  select count(*),
         count(*) filter (where w.created_at > now() - interval '24 hours'),
         string_agg(
           '<tr><td style="' || c || ';white-space:nowrap">'
             || to_char(case when w.source = 'paper' then w.received_on::timestamp
                             else w.created_at at time zone 'Africa/Lagos' end, 'DD Mon YYYY')
             || case when w.source = 'paper' then '<br>Paper slip' else '' end
             || case when w.created_at > now() - interval '24 hours' then '<br><strong>New</strong>' else '' end
             || '</td><td style="' || c || '">'
             || case when st.student_id is null then 'Not signed'
                     else html_escape(coalesce(nullif(btrim(st.preferred_name), ''), st.first_name) || ' ' || st.last_name)
                       || '<br>' || html_escape(concat_ws(' · ',
                            case when st.year_group is not null then 'Year ' || st.year_group end,
                            st.boarding_house)) end
             || '</td><td style="' || c || ';white-space:pre-wrap">' || html_escape(w.details)
             || '</td><td style="' || c || '">'
             || case when w.urgent then '<strong>Urgent</strong><br>' else '' end
             || case w.status when 'new' then 'Not yet read' else 'Open' end
             || '</td></tr>',
           '' order by w.created_at)
    into v_count, v_new, v_rows
  from worries w
  left join students st on st.student_id = w.student_id
  where w.category = 'staff' and w.status <> 'closed';

  if v_count = 0 then
    return 0;
  end if;

  perform queue_workspace_email(jsonb_build_object(
    'to', to_jsonb(v_emails),
    'subject', 'Worry Box: worries about staff, ' || to_char(school_today(), 'DD Mon YYYY')
      || ' (' || v_count || case when v_count = 1 then ' item' else ' items' end
      || case when v_new > 0 then ', ' || v_new || ' new' else '' end || ')',
    'html', '<p><strong>Confidential: safeguarding.</strong> Worries from the students'' Worry Box about a member of staff '
      || 'that are not closed yet, oldest first. "New" means it came in during the last 24 hours.</p>'
      || '<table style="border-collapse:collapse;font-size:14px">'
      || '<tr><th style="' || c || ';text-align:left">Received</th><th style="' || c || ';text-align:left">Student</th>'
      || '<th style="' || c || ';text-align:left">What the student wrote</th><th style="' || c || ';text-align:left">Status</th></tr>'
      || v_rows || '</table>'
      || '<p>Notes, replies and closing are in the Worry Box: '
      || '<a href="https://misform.work/worry-box">https://misform.work/worry-box</a></p>',
    'reply_to', email_reply_to('worry_box_staff'),
    'private', true));

  return v_count;
end;
$$;

revoke execute on function public.send_staff_worry_list() from public, anon, authenticated;

select cron.schedule('worry-box-staff-daily', '15 15 * * *', 'select public.send_staff_worry_list()');
