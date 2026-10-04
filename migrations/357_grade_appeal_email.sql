-- Migration 357: mark appeals are emailed to the teacher, with the Head of
-- Department in cc.
--
-- Why: the principal, 4 Oct 2026: "Email the teacher, cc to the HoD." Until
-- now a new appeal only reached the teacher's (and, since 355, the HoD's)
-- Formwork inbox, and nothing turns an inbox message into an email, so a
-- teacher who didn't open Formwork never heard about it.
--
-- appeal_grade() now also queues one email through queue_workspace_email():
-- to the student's teacher(s) for the subject (staff.email of the classes'
-- teachers), cc the subject's Head of Department (left out if they are
-- also the teacher). The inbox messages stay as they were. The decision
-- isn't emailed (the student and HoD still get it in their inbox).
--
-- Replies go through a new email_reply_routes row, 'grade_appeal', seeded
-- with sro@abc.sch.ng like the other rows (mis@ is not read); it can be
-- changed at /admin/email-replies.
--
-- The student's reason (and names) go into the HTML through html_escape(),
-- new here, so text a student types can't add links or markup to a staff
-- email.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.html_escape(p text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select replace(replace(replace(replace(replace(p,
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$$;

insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('grade_appeal', 'Mark appeal', 'The email to a teacher (Head of Department copied in) when a student appeals a mark.',
   null, 55, false, false, array['sro@abc.sch.ng'])
on conflict (email_kind) do nothing;

create or replace function public.appeal_grade(p_result_id integer, p_claimed_score numeric, p_reason text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
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

  -- One student at a time, so two quick taps can't both spend the last credit.
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

  -- The Head of Department gets a copy (the principal, 4 Oct 2026), saying
  -- who it has gone to. The teacher still decides. Someone who is both the
  -- teacher and the HoD gets only the teacher's message.
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

  -- Email (the principal, 4 Oct 2026): to the teacher, the HoD in cc, as
  -- well as the inbox messages above. The student's reason is their own
  -- text, so it is escaped before going into the HTML.
  select array_agg(distinct lower(btrim(st.email))) into v_to
  from student_class sc
  join classes c on c.class_id = sc.class_id and c.subject_id = v_result.subject_id
  join staff st on st.staff_id = c.staff_id
  where sc.student_id = v_student and is_plain_email(lower(btrim(st.email)));

  select array_agg(distinct lower(btrim(st.email))) into v_cc
  from subjects s
  join staff_roles sr on sr.role_name = 'head_of_department'
    and sr.scope_type = 'department' and sr.scope_value = s.department_name
  join staff st on st.staff_id = sr.staff_id
  where s.subject_id = v_result.subject_id
    and is_plain_email(lower(btrim(st.email)))
    and not (lower(btrim(st.email)) = any (coalesce(v_to, array[]::text[])));

  if v_to is not null then
    v_html := '<p><strong>' || html_escape(v_name) || '</strong> has appealed their '
      || html_escape(v_subject) || ' mark' || coalesce(' for ' || html_escape(v_set), '') || ': '
      || coalesce(v_result.score::text || coalesce(' / ' || v_result.max_score::text, ''), '')
      || coalesce(' (' || html_escape(v_result.grade) || ')', '') || '.</p>'
      || case when p_claimed_score is not null
              then '<p>They say their marked paper shows ' || p_claimed_score::text || '.</p>' else '' end
      || '<p><em>Their reason:</em> ' || html_escape(v_reason) || '</p>'
      || '<p>Please check their paper and decide in Formwork: '
      || '<a href="https://misform.work/grade-appeals">https://misform.work/grade-appeals</a>. '
      || 'Each appeal holds one of the student''s credits until you decide, so please decide promptly.</p>'
      || case when v_cc is not null
              then '<p>The Head of Department is copied in for information.</p>' else '' end;

    perform queue_workspace_email(jsonb_build_object(
      'to', to_jsonb(v_to),
      'cc', to_jsonb(coalesce(v_cc, array[]::text[])),
      'subject', 'Mark appeal: ' || v_name || ', ' || v_subject,
      'html', v_html,
      'reply_to', email_reply_to('grade_appeal')));
  end if;

  return v_id;
end;
$$;
