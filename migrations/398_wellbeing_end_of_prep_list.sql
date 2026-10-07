-- Migration 398: one wellbeing list at the end of prep, instead of a message
-- for every check-in.
--
-- Why (the principal, 8 Oct 2026): "We are being flooded by automatic emails
-- as students complete the check-in. CS and principal need one list sent to
-- us at the end of prep listing names and area of concern." In the first
-- round each flagged check-in posted an inbox message to both of them (344
-- so far), plus an email at most once an hour.
--
-- Now:
--   * notify_wellbeing_flag() does nothing, so a check-in sends nothing at
--     the moment it is given. (give_wellbeing_check_in() still calls it.)
--   * send_wellbeing_list(), run by the cron job "wellbeing-end-of-prep" at
--     21:50 Lagos every day (prep ends at 21:15 for KS3 and 21:45 for KS4
--     and Year 12), emails the DSL and the principal one list of every
--     flagged check-in given since the last list: name, year, house, priority
--     (red, amber, green) and the areas of concern, red first. Nothing is
--     sent on a day with none. Each check-in goes on one list only
--     (wellbeing_check_ins.listed_at). They also get one inbox message saying
--     how many are on the list, without names.
--   * The email names students, which the earlier notices deliberately
--     didn't. The principal asked for names, so the email is marked private:
--     the email outbox's read policies (admins; SMT, pastoral and the school
--     office) now leave out private emails, so a copy of the list can't be
--     read there by anyone but the two people it goes to.
--   * Priority and areas use the rule of migration 397 (lib/wellbeing.js),
--     written again here in wellbeing_check_in_triage(); keep the two in step.

set local formwork.change_note = 'Principal (direct)';

alter table public.wellbeing_check_ins add column if not exists listed_at timestamptz;

-- ---- Priority and areas, as lib/wellbeing.js -------------------------------

create or replace function public.wellbeing_check_in_triage(p_check_in_id bigint)
returns table (tier text, issues text[])
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with a as (
    select q.*, w.score, w.answer, w.alert,
           case when q.kind = 'scale' then case when q.good_high then w.score else 6 - w.score end end as good_score
    from wellbeing_answers w join wellbeing_questions q on q.question_id = w.question_id
    where w.check_in_id = p_check_in_id
  ),
  c as (select * from wellbeing_check_ins where check_in_id = p_check_in_id)
  select
    case
      when not c.flagged then null
      when exists (select 1 from a where (a.alert and a.priority = 'red')
                                      or (a.red_at is not null and a.good_score <= a.red_at)) then 'red'
      when c.comment is not null
        or exists (select 1 from a where a.alert and a.priority = 'amber')
        or (select count(*) from a where a.alert) >= 4 then 'amber'
      else 'green'
    end,
    array(
      select i from unnest(array['safety', 'low_mood', 'needs_adult', 'pressure', 'friendships',
                                 'home_boarding', 'sleep_eating', 'comment']) with ordinality as o(i, n)
      where (i = 'comment' and c.comment is not null)
         or exists (select 1 from a where a.alert and a.issue = o.i)
      order by o.n)
  from c;
$$;

revoke execute on function public.wellbeing_check_in_triage(bigint) from public, anon, authenticated;

create or replace function public.wellbeing_issue_label(p_issue text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_issue
    when 'safety' then 'Safety'
    when 'low_mood' then 'Low mood'
    when 'needs_adult' then 'Wants an adult to talk to'
    when 'pressure' then 'Pressure and workload'
    when 'friendships' then 'Friendships and unkindness'
    when 'home_boarding' then 'Home and boarding'
    when 'sleep_eating' then 'Sleep and eating'
    when 'comment' then 'Wrote a comment'
    else p_issue end;
$$;

-- ---- No message for each check-in ------------------------------------------

create or replace function public.notify_wellbeing_flag()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Since migration 398 flagged check-ins are sent as one list at the end of
  -- prep (send_wellbeing_list()); nothing is sent as each one arrives.
  return;
end;
$$;

revoke execute on function public.notify_wellbeing_flag() from public, anon, authenticated;

-- ---- Private emails are kept out of the outbox read policies ---------------

alter policy admin_read_email_outbox on public.email_outbox
  using (is_admin() and coalesce(payload ->> 'private', 'false') <> 'true');
alter policy staff_comms_read_email_outbox on public.email_outbox
  using (user_has_staff_role(array['smt', 'pastoral', 'school_office'])
         and coalesce(payload ->> 'private', 'false') <> 'true');

-- ---- The end-of-prep list ---------------------------------------------------

create or replace function public.send_wellbeing_list()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rows text := '';
  v_count integer := 0;
  v_red integer := 0;
  v_amber integer := 0;
  v_ids bigint[];
  v_emails text[];
  v_profiles uuid[];
  r record;
begin
  perform pg_advisory_xact_lock(hashtext('wellbeing_list'));

  for r in
    select c.check_in_id, c.year_group, c.boarding_house,
           coalesce(s.preferred_name, s.first_name) || ' ' || s.last_name as student_name,
           t.tier, t.issues
    from wellbeing_check_ins c
    join students s on s.student_id = c.student_id
    cross join lateral wellbeing_check_in_triage(c.check_in_id) t
    where c.flagged and c.listed_at is null and c.followed_up_at is null
    order by case t.tier when 'red' then 0 when 'amber' then 1 else 2 end,
             c.boarding_house nulls last, c.year_group, s.last_name, s.first_name
  loop
    v_count := v_count + 1;
    v_ids := array_append(v_ids, r.check_in_id);
    if r.tier = 'red' then v_red := v_red + 1; elsif r.tier = 'amber' then v_amber := v_amber + 1; end if;
    v_rows := v_rows || '<tr>'
      || '<td style="padding:4px 8px;font-weight:bold;color:'
      || case r.tier when 'red' then '#a3232c' when 'amber' then '#8a5a00' else '#1a7a3d' end || '">'
      || initcap(r.tier) || '</td>'
      || '<td style="padding:4px 8px">' || html_escape(r.student_name) || '</td>'
      || '<td style="padding:4px 8px">' || coalesce(r.year_group::text, '') || '</td>'
      || '<td style="padding:4px 8px">' || html_escape(coalesce(r.boarding_house, '')) || '</td>'
      || '<td style="padding:4px 8px">'
      || coalesce((select string_agg(wellbeing_issue_label(i), ', ') from unnest(r.issues) i), '') || '</td>'
      || '</tr>';
  end loop;

  if v_count = 0 then
    return 0;
  end if;

  select array_agg(distinct lower(btrim(s.email))) into v_emails
  from staff_roles sr join staff s on s.staff_id = sr.staff_id
  where sr.role_name in ('dsl', 'principal') and is_plain_email(lower(btrim(s.email)));

  select array_agg(distinct p.id) into v_profiles
  from staff_roles sr join profiles p on p.staff_id = sr.staff_id
  where sr.role_name in ('dsl', 'principal');

  if v_emails is not null then
    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(v_emails),
      'private', true,
      'subject', 'Wellbeing check-ins to follow up: ' || v_count
        || ' (' || v_red || ' red, ' || v_amber || ' amber)',
      'html', '<p>' || v_count || ' wellbeing check-in' || case when v_count = 1 then '' else 's' end
        || ' given since the last list ' || case when v_count = 1 then 'needs' else 'need' end
        || ' a look: ' || v_red || ' red, ' || v_amber || ' amber, ' || (v_count - v_red - v_amber) || ' green.</p>'
        || '<p>Red: you or the DSL see the student. Amber: a conversation with someone you choose. '
        || 'Green: no one-to-one follow-up.</p>'
        || '<table style="border-collapse:collapse" border="1">'
        || '<tr><th style="padding:4px 8px">Priority</th><th style="padding:4px 8px">Student</th>'
        || '<th style="padding:4px 8px">Year</th><th style="padding:4px 8px">House</th>'
        || '<th style="padding:4px 8px">Areas of concern</th></tr>'
        || v_rows || '</table>'
        || '<p>The answers are on the Wellbeing page: '
        || '<a href="https://misform.work/wellbeing">https://misform.work/wellbeing</a>. '
        || 'This list is confidential to the DSL and the Principal.</p>',
      'reply_to', email_reply_to('wellbeing')));
  end if;

  perform post_inbox_notice(v_profiles,
    'Wellbeing list: ' || v_count || ' to follow up',
    '<p>Tonight''s wellbeing list has ' || v_count || ' check-in' || case when v_count = 1 then '' else 's' end
      || ' to follow up (' || v_red || ' red, ' || v_amber || ' amber). The names are in your email and on the Wellbeing page: https://misform.work/wellbeing</p>',
    'wellbeing');

  update wellbeing_check_ins set listed_at = now() where check_in_id = any (v_ids);
  return v_count;
end;
$$;

revoke execute on function public.send_wellbeing_list() from public, anon, authenticated;

-- 21:50 Lagos = 20:50 UTC.
select cron.schedule('wellbeing-end-of-prep', '50 20 * * *', 'select public.send_wellbeing_list()');
