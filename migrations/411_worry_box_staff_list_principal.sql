-- Migration 411: the principal gets the daily list of worries about staff too.
--
-- Why (the principal, 8 Oct 2026): "Copy me each day", after being sent a
-- one-off copy of the first 4.15 pm list (migration 410) the DSL received.
-- The principal is the ADSL and already reads every worry with the name.
--
--   * send_staff_worry_list() now sends to the holders of the `dsl` and
--     `principal` roles (cs@ and principal@ today), found at send time, both
--     on the To line. Nothing else changes: same time, same
--     not-closed 'staff' worries with names, private, reply-to principal@.

set local formwork.change_note = 'Principal (direct)';

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
  where sr.role_name in ('dsl', 'principal') and is_plain_email(lower(btrim(s.email)));
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

