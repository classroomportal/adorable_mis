-- Migration 355: mark appeals copied to the Head of Department, and their
-- rules on the Lookups page.
--
-- Why: the principal, 4 Oct 2026, after migration 354: "Copy to HOD with a
-- note that it has been sent to the teacher and add it to the lookup page."
--
-- 1. When a student appeals a mark, the Head of Department for the subject's
--    department (staff_roles head_of_department, scope_type 'department',
--    matched to subjects.department_name, as is_hod_for_subject()) gets a
--    copy in their Formwork inbox saying which teacher it has been sent to.
--    The teacher still decides; the HoD can't. An HoD who is also the
--    student's teacher gets only the teacher's message. HoDs can now read
--    their department's appeals on /grade-appeals, so they can follow them.
--
-- 2. The appeal window (days) and credits per year
--    (academic_years.grade_appeal_days / grade_appeal_credits) are edited on
--    /admin/lookups through set_grade_appeal_rules(), which checks the caller
--    has the Lookups page, like set_behaviour_rules(). Changing them doesn't
--    touch appeals already made; credits are counted against the new number.

set local formwork.change_note = 'Principal (direct)';

-- ---- 1. Copy to the Head of Department ------------------------------------

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

  return v_id;
end;
$$;

create policy hod_read_grade_appeals on public.grade_appeals
  for select using (is_hod_for_subject(subject_id));

-- ---- 2. The rules on Lookups ----------------------------------------------

create or replace function public.set_grade_appeal_rules(p_academic_year_id integer, p_days integer, p_credits integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change the mark appeal rules.';
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'The appeal window must be between 1 and 60 days.';
  end if;
  if p_credits is null or p_credits < 0 or p_credits > 50 then
    raise exception 'Credits must be between 0 and 50.';
  end if;
  update academic_years
  set grade_appeal_days = p_days, grade_appeal_credits = p_credits
  where academic_year_id = p_academic_year_id and status <> 'closed';
  if not found then
    raise exception 'That school year was not found or is closed.';
  end if;
end;
$$;

revoke execute on function public.set_grade_appeal_rules(integer, integer, integer) from public, anon;
grant execute on function public.set_grade_appeal_rules(integer, integer, integer) to authenticated;
