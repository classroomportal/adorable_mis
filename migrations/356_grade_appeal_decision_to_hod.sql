-- Migration 356: Heads of Department also get the decision on a mark appeal.
--
-- Why: the principal, 4 Oct 2026: "Yes, send the HoD the decision too."
-- Migration 355 copied each new appeal to the subject's Head of Department.
-- decide_grade_appeal() now also sends them the outcome: who decided, the
-- mark appealed, the corrected mark (upheld) or that it stands (turned
-- down), and the teacher's note. An HoD who decided it themselves (as the
-- student's teacher) isn't sent a copy of their own decision. Nothing else
-- about deciding changes.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.decide_grade_appeal(
  p_appeal_id bigint, p_upheld boolean, p_new_score numeric, p_new_grade text, p_note text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_appeal grade_appeals%rowtype;
  v_result results%rowtype;
  v_staff integer;
  v_year_group integer;
  v_grade text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_subject text;
  v_set text;
  v_student text;
  v_teacher text;
  v_hods uuid[];
begin
  select * into v_appeal from grade_appeals where appeal_id = p_appeal_id for update;
  if not found then
    raise exception 'That appeal was not found.';
  end if;
  if not teaches_student_for_subject(v_appeal.student_id, v_appeal.subject_id) then
    raise exception 'Only the student''s teacher for this subject can decide this appeal.';
  end if;
  if v_appeal.status <> 'pending' then
    raise exception 'This appeal has already been decided.';
  end if;
  if p_upheld is null then
    raise exception 'Choose whether to uphold the appeal or turn it down.';
  end if;

  select staff_id into v_staff from profiles where id = auth.uid();

  if p_upheld then
    select * into v_result from results where result_id = v_appeal.result_id for update;
    if not found then
      raise exception 'This mark has been deleted, so it can''t be corrected here. Enter it again on Enter Results, then uphold.';
    end if;

    if p_new_score is not null then
      if p_new_score < 0 or (v_result.max_score is not null and p_new_score > v_result.max_score) then
        raise exception 'The corrected score must be between 0 and %.', coalesce(v_result.max_score, 100);
      end if;
      select year_group into v_year_group from students where student_id = v_appeal.student_id;
      select b.grade into v_grade
      from subject_grade_boundaries b
      where b.subject_id = v_result.subject_id and b.year_group = v_year_group
        and b.min_score <= p_new_score * 100 / coalesce(nullif(v_result.max_score, 0), 100)
      order by b.min_score desc limit 1;
      update results
      set score = p_new_score, grade = coalesce(v_grade, nullif(btrim(p_new_grade), ''), grade)
      where result_id = v_result.result_id;
    elsif nullif(btrim(coalesce(p_new_grade, '')), '') is not null then
      update results set grade = btrim(p_new_grade) where result_id = v_result.result_id;
    end if;

    select * into v_result from results where result_id = v_appeal.result_id;
    if v_result.score is not distinct from v_appeal.score_appealed
       and v_result.grade is not distinct from v_appeal.grade_appealed then
      raise exception 'Enter the corrected mark to uphold the appeal (it is still the mark that was appealed).';
    end if;

    update grade_appeals
    set status = 'upheld', decided_at = now(), decided_by = v_staff, decision_note = v_note,
        new_score = v_result.score, new_grade = v_result.grade
    where appeal_id = p_appeal_id;
  else
    if v_note is null then
      raise exception 'Please say why the mark stands; the student will see it.';
    end if;
    update grade_appeals
    set status = 'turned_down', decided_at = now(), decided_by = v_staff, decision_note = v_note
    where appeal_id = p_appeal_id;
  end if;

  select coalesce(display_name, subject_name) into v_subject from subjects where subject_id = v_appeal.subject_id;
  select event_name into v_set from calendar_events where event_id = v_appeal.result_set_event_id;

  perform post_inbox_notice(
    (select array_agg(id) from profiles where student_id = v_appeal.student_id),
    'Your ' || v_subject || ' appeal: ' || case when p_upheld then 'upheld' else 'turned down' end,
    case when p_upheld
      then '<p>Your appeal against your ' || v_subject || ' mark' || coalesce(' for ' || v_set, '')
        || ' has been upheld. Your mark is now '
        || coalesce(v_result.score::text || coalesce(' / ' || v_result.max_score::text, ''), '')
        || coalesce(' (' || v_result.grade || ')', '') || '. Your appeal credit has been given back.</p>'
      else '<p>Your appeal against your ' || v_subject || ' mark' || coalesce(' for ' || v_set, '')
        || ' has been turned down, so the mark stands and one appeal credit has been used.</p>'
    end
    || coalesce('<p>Your teacher''s note: ' || v_note || '</p>', ''),
    'grade_appeal');

  -- The Head of Department gets the decision too (the principal, 4 Oct
  -- 2026), as they got the appeal (migration 355); not the teacher who
  -- decided, if they are the HoD themselves.
  select first_name || ' ' || last_name into v_student from students where student_id = v_appeal.student_id;
  select first_name || ' ' || last_name into v_teacher from staff where staff_id = v_staff;

  select array_agg(distinct p.id) into v_hods
  from subjects s
  join staff_roles sr on sr.role_name = 'head_of_department'
    and sr.scope_type = 'department' and sr.scope_value = s.department_name
  join profiles p on p.staff_id = sr.staff_id
  where s.subject_id = v_appeal.subject_id
    and p.id is distinct from auth.uid();

  perform post_inbox_notice(
    v_hods,
    'Copy: mark appeal ' || case when p_upheld then 'upheld' else 'turned down' end || ': ' || v_student || ', ' || v_subject,
    '<p>For your information as Head of Department. ' || coalesce(v_teacher, 'The teacher') || ' has '
      || case when p_upheld then 'upheld' else 'turned down' end || ' <strong>' || v_student || '</strong>''s appeal against their '
      || v_subject || ' mark' || coalesce(' for ' || v_set, '') || '.</p>'
      || '<p>Mark appealed: '
      || coalesce(v_appeal.score_appealed::text || coalesce(' / ' || v_appeal.max_score_appealed::text, ''), '')
      || coalesce(' (' || v_appeal.grade_appealed || ')', '') || '.'
      || case when p_upheld
           then ' Corrected to ' || coalesce(v_result.score::text || coalesce(' / ' || v_result.max_score::text, ''), '')
                || coalesce(' (' || v_result.grade || ')', '') || '.'
           else ' The mark stands.' end
      || '</p>'
      || coalesce('<p>Teacher''s note: ' || v_note || '</p>', '')
      || '<p>https://misform.work/grade-appeals</p>',
    'grade_appeal');
end;
$$;
