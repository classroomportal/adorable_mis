-- 420: mark appeal emails become one daily summary; both summaries at 16:15
--
-- Why: the principal, 9 Oct 2026, after migration 419 made the behaviour
-- alert email a daily summary: "do those [the mark appeal emails] as well
-- and then ... send out at 16.15 each day".
--
-- Mark appeals (migration 357): appeal_grade() emailed the student's
-- teacher(s), cc the subject's HoD, once per appeal. Now:
--   * appeal_grade() is unchanged except its last step: instead of queueing
--     the email it adds a row to mark_appeal_digest with the same to / cc
--     lists and the same paragraph about the appeal. The inbox notices to
--     the teacher and the HoD still go at once.
--   * send_mark_appeal_digest() (cron "mark-appeal-daily-digest") sends one
--     email per set of recipients (the same teacher(s) and HoD cc as
--     before), listing each appeal still pending, reply-to
--     email_reply_to('grade_appeal') as before. An appeal decided or
--     withdrawn before the summary goes is left out (counted only), since
--     there is nothing left to do. Nothing is sent when nothing is queued.
--   * Students still have 5 days to appeal and teachers see the appeal in
--     their inbox and on /grade-appeals straight away; only the email waits.
--
-- Both summaries now go at 16:15 Lagos (15:15 UTC): this file moves the
-- "behaviour-alert-daily-digest" cron from 15:30 UTC (migration 419).
--
-- mark_appeal_digest has RLS and no grants. send_mark_appeal_digest() has
-- execute revoked. Rows are kept with sent_at stamped, not deleted.

create table public.mark_appeal_digest (
  id bigserial primary key,
  appeal_id bigint not null,
  to_list text[] not null,
  cc_list text[] not null default array[]::text[],
  item_html text not null,
  queued_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.mark_appeal_digest enable row level security;
-- No grants: written by appeal_grade(), read by the cron function only.

create index mark_appeal_digest_unsent on public.mark_appeal_digest (queued_at) where sent_at is null;

create or replace function public.appeal_grade(p_result_id integer, p_claimed_score numeric, p_reason text)
 returns bigint
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student integer := my_student_id();
  v_result results%rowtype;
  v_year academic_years%rowtype;
  v_marked_at timestamptz;
  v_mark_date date;
  v_open integer;
  v_last timestamptz;
  v_teachers uuid[];
  v_hods uuid[];
  v_teacher_names text;
  v_to text[];
  v_cc text[];
  v_html text;
  v_id bigint;
  v_name text;
  v_subject text;
  v_set text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_student is null then
    raise exception 'Only students can appeal a mark.';
  end if;

  select * into v_result from results where result_id = p_result_id;
  if not found or v_result.student_id <> v_student then
    raise exception 'That mark was not found.';
  end if;

  if v_reason = '' then
    raise exception 'Please explain why you think the mark is wrong.';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'Please keep the reason under 1000 characters.';
  end if;
  if p_claimed_score is not null
     and (p_claimed_score < 0 or (v_result.max_score is not null and p_claimed_score > v_result.max_score)) then
    raise exception 'The mark on your paper must be between 0 and %.', coalesce(v_result.max_score, 100);
  end if;

  select * into v_year from academic_years where status = 'current';
  if not found then
    raise exception 'Appeals are closed: there is no current school year.';
  end if;

  perform pg_advisory_xact_lock(hashtext('grade_appeal'), v_student);

  v_marked_at := result_marked_at(p_result_id);
  v_mark_date := (v_marked_at at time zone 'Africa/Lagos')::date;
  if school_today() > v_mark_date + v_year.grade_appeal_days then
    raise exception 'Appeals for this mark closed on %: you have % days from the day a mark appears.',
      to_char(v_mark_date + v_year.grade_appeal_days, 'DD/MM/YYYY'), v_year.grade_appeal_days;
  end if;

  select max(created_at) into v_last from grade_appeals
  where result_id = p_result_id and status <> 'withdrawn';
  if exists (select 1 from grade_appeals where result_id = p_result_id and status = 'pending') then
    raise exception 'You have already appealed this mark.';
  end if;
  if v_last is not null and v_last >= v_marked_at then
    raise exception 'This mark has already been appealed and decided. You can appeal again only if it changes.';
  end if;

  select count(*) into v_open from grade_appeals
  where student_id = v_student and academic_year_id = v_year.academic_year_id
    and status in ('pending', 'turned_down');
  if v_open >= v_year.grade_appeal_credits then
    raise exception 'You have no appeal credits left this year. An appeal that is upheld gives its credit back.';
  end if;

  v_teachers := grade_appeal_teacher_logins(v_student, v_result.subject_id);
  if v_teachers is null then
    raise exception 'Formwork can''t find your teacher for this subject, so the appeal can''t be sent. Please speak to your mentor.';
  end if;

  insert into grade_appeals (
    result_id, student_id, subject_id, result_set_event_id, academic_year_id,
    score_appealed, max_score_appealed, grade_appealed, claimed_score, reason)
  values (
    p_result_id, v_student, v_result.subject_id, v_result.result_set_event_id, v_year.academic_year_id,
    v_result.score, v_result.max_score, v_result.grade, p_claimed_score, v_reason)
  returning appeal_id into v_id;

  select first_name || ' ' || last_name into v_name from students where student_id = v_student;
  select coalesce(display_name, subject_name) into v_subject from subjects where subject_id = v_result.subject_id;
  select event_name into v_set from calendar_events where event_id = v_result.result_set_event_id;

  perform post_inbox_notice(
    v_teachers,
    'Mark appeal: ' || v_name || ', ' || v_subject,
    '<p><strong>' || v_name || '</strong> has appealed their ' || v_subject || ' mark'
      || coalesce(' for ' || v_set, '') || ': '
      || coalesce(v_result.score::text || coalesce(' / ' || v_result.max_score::text, ''), '')
      || coalesce(' (' || v_result.grade || ')', '') || '.</p>'
      || case when p_claimed_score is not null
              then '<p>They say their marked paper shows ' || p_claimed_score::text || '.</p>' else '' end
      || '<p>' || v_reason || '</p>'
      || '<p>Please check their paper and decide: https://misform.work/grade-appeals</p>',
    'grade_appeal');

  select string_agg(distinct st.first_name || ' ' || st.last_name, ', ')
  into v_teacher_names
  from student_class sc
  join classes c on c.class_id = sc.class_id and c.subject_id = v_result.subject_id
  join staff st on st.staff_id = c.staff_id
  where sc.student_id = v_student;

  select array_agg(distinct p.id) into v_hods
  from subjects s
  join staff_roles sr on sr.role_name = 'head_of_department'
    and sr.scope_type = 'department' and sr.scope_value = s.department_name
  join profiles p on p.staff_id = sr.staff_id
  where s.subject_id = v_result.subject_id
    and not (p.id = any (v_teachers));

  perform post_inbox_notice(
    v_hods,
    'Copy: mark appeal: ' || v_name || ', ' || v_subject,
    '<p>For your information as Head of Department. This appeal has been sent to '
      || coalesce(v_teacher_names, 'the teacher') || ' to decide; you don''t need to do anything.</p>'
      || '<p><strong>' || v_name || '</strong> has appealed their ' || v_subject || ' mark'
      || coalesce(' for ' || v_set, '') || ': '
      || coalesce(v_result.score::text || coalesce(' / ' || v_result.max_score::text, ''), '')
      || coalesce(' (' || v_result.grade || ')', '') || '.</p>'
      || case when p_claimed_score is not null
              then '<p>They say their marked paper shows ' || p_claimed_score::text || '.</p>' else '' end
      || '<p>' || v_reason || '</p>'
      || '<p>You can follow it at https://misform.work/grade-appeals</p>',
    'grade_appeal');

  select array_agg(distinct lower(btrim(st.email)) order by lower(btrim(st.email))) into v_to
  from student_class sc
  join classes c on c.class_id = sc.class_id and c.subject_id = v_result.subject_id
  join staff st on st.staff_id = c.staff_id
  where sc.student_id = v_student and is_plain_email(lower(btrim(st.email)));

  select array_agg(distinct lower(btrim(st.email)) order by lower(btrim(st.email))) into v_cc
  from subjects s
  join staff_roles sr on sr.role_name = 'head_of_department'
    and sr.scope_type = 'department' and sr.scope_value = s.department_name
  join staff st on st.staff_id = sr.staff_id
  where s.subject_id = v_result.subject_id
    and is_plain_email(lower(btrim(st.email)))
    and not (lower(btrim(st.email)) = any (coalesce(v_to, array[]::text[])));

  -- The email goes in the daily summary (send_mark_appeal_digest(), migration 420).
  if v_to is not null then
    v_html := '<p><strong>' || html_escape(v_name) || '</strong> has appealed their '
      || html_escape(v_subject) || ' mark' || coalesce(' for ' || html_escape(v_set), '') || ': '
      || coalesce(v_result.score::text || coalesce(' / ' || v_result.max_score::text, ''), '')
      || coalesce(' (' || html_escape(v_result.grade) || ')', '') || '.</p>'
      || case when p_claimed_score is not null
              then '<p>They say their marked paper shows ' || p_claimed_score::text || '.</p>' else '' end
      || '<p><em>Their reason:</em> ' || html_escape(v_reason) || '</p>';

    insert into mark_appeal_digest (appeal_id, to_list, cc_list, item_html)
    values (v_id, v_to, coalesce(v_cc, array[]::text[]), v_html);
  end if;

  return v_id;
end;
$function$;

create or replace function public.send_mark_appeal_digest()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_key text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_sent integer := 0;
  g record;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'send_workspace_email_key';

  for g in
    select d.to_list, d.cc_list,
           array_agg(d.id) as ids,
           count(*) filter (where a.status = 'pending') as live,
           count(*) filter (where a.status is distinct from 'pending') as gone,
           string_agg(d.item_html, '<hr style="border:none;border-top:1px solid #ddd"/>' order by d.queued_at)
             filter (where a.status = 'pending') as items
    from mark_appeal_digest d
    left join grade_appeals a on a.appeal_id = d.appeal_id
    where d.sent_at is null
    group by d.to_list, d.cc_list
  loop
    update mark_appeal_digest set sent_at = now() where id = any (g.ids);

    if g.live > 0 and v_key is not null then
      perform public.queue_workspace_email(jsonb_build_object(
        'to', to_jsonb(g.to_list),
        'cc', to_jsonb(g.cc_list),
        'subject', 'Mark appeals: daily summary, ' || to_char(v_today, 'FMDD Mon YYYY') ||
                   ' (' || g.live || case when g.live = 1 then ' appeal)' else ' appeals)' end,
        'html',
          '<p>Mark appeals waiting for you to decide: <strong>' || g.live || '</strong>' ||
          case when g.gone > 0 then ' (and ' || g.gone || ' already decided or withdrawn, not listed)' else '' end ||
          '. Each was also posted to your Formwork inbox when it was made.</p>' ||
          g.items ||
          '<hr style="border:none;border-top:1px solid #ddd"/>' ||
          '<p>Please check the papers and decide in Formwork: '
          || '<a href="https://misform.work/grade-appeals">https://misform.work/grade-appeals</a>. '
          || 'Each appeal holds one of the student''s credits until you decide, so please decide promptly.</p>' ||
          case when cardinality(g.cc_list) > 0
               then '<p>The Head of Department is copied in for information.</p>' else '' end,
        'reply_to', email_reply_to('grade_appeal')));
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$function$;

revoke execute on function public.send_mark_appeal_digest() from public, anon, authenticated;

update public.email_reply_routes
   set description = 'The daily summary to a teacher (Head of Department copied in) of the mark appeals students made that day, at 4.15 pm.'
 where email_kind = 'grade_appeal';

update public.email_reply_routes
   set description = 'The daily summary of behaviour alerts (a -5 event or a week at -8) to cs@abc.sch.ng, SMT and the SRO copied in, at 4.15 pm.'
 where email_kind = 'behaviour_alert';

select cron.schedule('mark-appeal-daily-digest', '15 15 * * *', 'select public.send_mark_appeal_digest()');
select cron.schedule('behaviour-alert-daily-digest', '15 15 * * *', 'select public.send_behaviour_alert_digest()');
