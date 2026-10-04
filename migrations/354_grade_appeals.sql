-- Migration 354: students can appeal a mark.
--
-- Why: the principal, 4 Oct 2026. "We have a problem with teachers entering
-- the wrong numbers for tests." Students see a score as soon as it is saved
-- (there is no release step), so the student is often the first to notice
-- that what Formwork shows isn't what is on their marked paper. They can now
-- appeal it, as they would an exam result, and the teacher checks the paper.
--
-- The principal's decisions:
--   * The teacher decides: whoever teaches the student that subject now
--     (teaches_student_for_subject(), the same people who can change the mark
--     on Enter Results). Not the HoD or an assessment manager.
--   * 5 days to appeal, from the day the mark appeared or last changed.
--   * Students only. Parents can't appeal (as with behaviour appeals).
--   * Every result set.
--   * 5 credits a year (the principal's idea), used only by an appeal that is
--     turned down: an upheld appeal gives its credit back, because the mistake
--     was the school's. A pending appeal holds a credit until it is decided,
--     so a student can't have more appeals open than credits left.
--     A student can withdraw a pending appeal; that gives the credit back too.
--
-- The two numbers are academic_years.grade_appeal_credits and
-- grade_appeal_days (both 5), not hard-coded.
--
-- An appeal is about whether the number in Formwork matches the marked
-- paper. The student says what the paper shows and why; the teacher either
-- corrects the mark (upheld) or explains why it stands (turned down). An
-- upheld appeal changes the result through decide_grade_appeal(), so the
-- change is in Grade History under the teacher's name, like any other.
-- If the teacher has already corrected the mark on Enter Results, upholding
-- needs no new number.
--
-- grade_appeals has select policies only: every write goes through
-- appeal_grade(), withdraw_grade_appeal() and decide_grade_appeal(), which
-- check the caller through auth.uid(). Appeals are never deleted.
-- Readable by the student (their own), the teacher who can decide them, and
-- SMT, assessment managers and admins, so the school can see which marks and
-- which teachers' entries are being corrected.

set local formwork.change_note = 'Principal (direct)';

-- ---- The rules ------------------------------------------------------------

alter table public.academic_years
  add column if not exists grade_appeal_credits integer not null default 5
    check (grade_appeal_credits between 0 and 50),
  add column if not exists grade_appeal_days integer not null default 5
    check (grade_appeal_days between 1 and 60);

-- ---- The table ------------------------------------------------------------

create table public.grade_appeals (
  appeal_id bigint generated always as identity primary key,
  -- Kept if the score is later deleted, so the appeal (and the credit it
  -- used) isn't lost; the snapshot below says what was appealed.
  result_id integer references public.results(result_id) on delete set null,
  student_id integer not null references public.students(student_id),
  subject_id integer not null references public.subjects(subject_id),
  result_set_event_id integer references public.calendar_events(event_id),
  academic_year_id integer not null references public.academic_years(academic_year_id),
  score_appealed numeric,
  max_score_appealed numeric,
  grade_appealed text,
  claimed_score numeric,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'upheld', 'turned_down', 'withdrawn')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by integer references public.staff(staff_id),
  decision_note text,
  new_score numeric,
  new_grade text
);

create index grade_appeals_student_idx on public.grade_appeals (student_id, academic_year_id);
create index grade_appeals_result_idx on public.grade_appeals (result_id);
create index grade_appeals_pending_idx on public.grade_appeals (subject_id, student_id) where status = 'pending';
-- One open appeal per mark (also stops a double tap making two).
create unique index grade_appeals_one_pending on public.grade_appeals (result_id) where status = 'pending';

alter table public.grade_appeals enable row level security;
grant select on public.grade_appeals to authenticated;

create policy student_read_own_grade_appeals on public.grade_appeals
  for select using (student_id = (select my_student_id()));

create policy teacher_read_grade_appeals on public.grade_appeals
  for select using (teaches_student_for_subject(student_id, subject_id));

create policy oversight_read_grade_appeals on public.grade_appeals
  for select using ((select is_admin()) or (select has_staff_role(array['smt', 'assessment_manager'])));

-- ---- Helpers --------------------------------------------------------------

-- When a mark appeared, or last changed (score or grade), from Grade
-- History; a re-import that changes nothing isn't logged, so it doesn't
-- reopen the window. Falls back to when the row was made.
create or replace function public.result_marked_at(p_result_id integer)
returns timestamptz
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select max(gh.changed_at)
     from grade_history gh
     join results r on r.result_id = p_result_id and gh.student_id = r.student_id
     where gh.table_name = 'results'
       and gh.record_key = jsonb_build_object('result_id', p_result_id)
       and (gh.action = 'INSERT'
            or (gh.action = 'UPDATE'
                and (gh.old_score is distinct from gh.new_score
                     or gh.old_grade is distinct from gh.new_grade)))),
    (select r.created_at from results r where r.result_id = p_result_id));
$$;

revoke execute on function public.result_marked_at(integer) from public, anon, authenticated;

-- Staff who can decide an appeal for this student and subject: the teacher
-- of any of the student's classes in it (teaches_student_for_subject()'s rule).
create or replace function public.grade_appeal_teacher_logins(p_student_id integer, p_subject_id integer)
returns uuid[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select array_agg(distinct p.id)
  from student_class sc
  join classes c on c.class_id = sc.class_id and c.subject_id = p_subject_id
  join profiles p on p.staff_id = c.staff_id
  where sc.student_id = p_student_id;
$$;

revoke execute on function public.grade_appeal_teacher_logins(integer, integer) from public, anon, authenticated;

-- The signed-in student's credits this academic year.
create or replace function public.my_grade_appeal_credits()
returns table (credits integer, used integer, held integer, credits_left integer, days integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select y.grade_appeal_credits,
         count(*) filter (where a.status = 'turned_down')::integer,
         count(*) filter (where a.status = 'pending')::integer,
         greatest(y.grade_appeal_credits - count(*) filter (where a.status in ('turned_down', 'pending')), 0)::integer,
         y.grade_appeal_days
  from academic_years y
  left join grade_appeals a
    on a.academic_year_id = y.academic_year_id and a.student_id = my_student_id()
  where y.status = 'current' and my_student_id() is not null
  group by y.academic_year_id, y.grade_appeal_credits, y.grade_appeal_days;
$$;

-- The signed-in student's marks that can still be appealed (window open),
-- with any appeal already made on them.
create or replace function public.my_appealable_marks()
returns table (
  result_id integer, subject_name text, result_set_name text, mark_date date,
  closes_on date, score numeric, max_score numeric, grade text,
  appeal_status text, can_appeal boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  v_student integer := my_student_id();
  v_days integer;
begin
  if v_student is null then
    return;
  end if;
  select grade_appeal_days into v_days from academic_years where status = 'current';
  if v_days is null then
    return;
  end if;

  return query
  with marks as (
    select r.*, result_marked_at(r.result_id) as marked_at,
           (result_marked_at(r.result_id) at time zone 'Africa/Lagos')::date as md
    from results r
    -- Only rows touched recently can be in their window.
    where r.student_id = v_student
      and r.updated_at >= now() - make_interval(days => v_days + 2)
  )
  select m.result_id,
         coalesce(s.display_name, s.subject_name),
         coalesce(e.event_name, 'Result'),
         m.md, m.md + v_days, m.score, m.max_score, m.grade,
         la.status,
         -- Open unless appealed since the mark last changed (a withdrawn
         -- appeal doesn't count).
         not exists (select 1 from grade_appeals a2
                     where a2.result_id = m.result_id and a2.status <> 'withdrawn'
                       and a2.created_at >= m.marked_at)
  from marks m
  join subjects s on s.subject_id = m.subject_id
  left join calendar_events e on e.event_id = m.result_set_event_id
  left join lateral (
    select a.appeal_id, a.status, a.created_at from grade_appeals a
    where a.result_id = m.result_id order by a.created_at desc limit 1
  ) la on true
  where school_today() <= m.md + v_days
  order by m.md desc, 2;
end;
$$;

-- ---- Appeal -----------------------------------------------------------------

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

  return v_id;
end;
$$;

create or replace function public.withdraw_grade_appeal(p_appeal_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  update grade_appeals set status = 'withdrawn', decided_at = now()
  where appeal_id = p_appeal_id and status = 'pending'
    and student_id = my_student_id() and my_student_id() is not null;
  if not found then
    raise exception 'That appeal can''t be withdrawn: it isn''t yours or has already been decided.';
  end if;
end;
$$;

-- ---- Decide -----------------------------------------------------------------

-- p_upheld true: the mark was wrong. p_new_score is the corrected score; the
-- grade is worked out from the subject's boundaries for the student's year
-- group (the highest band whose min_score the percentage reaches). For a
-- result with no score, p_new_grade is the corrected grade. Either can be
-- left out if the teacher has already corrected the mark on Enter Results.
-- p_upheld false: the mark stands; p_note (the reason) is required.
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
end;
$$;

revoke execute on function public.appeal_grade(integer, numeric, text) from public, anon;
revoke execute on function public.withdraw_grade_appeal(bigint) from public, anon;
revoke execute on function public.decide_grade_appeal(bigint, boolean, numeric, text, text) from public, anon;
revoke execute on function public.my_grade_appeal_credits() from public, anon;
revoke execute on function public.my_appealable_marks() from public, anon;
grant execute on function public.appeal_grade(integer, numeric, text) to authenticated;
grant execute on function public.withdraw_grade_appeal(bigint) to authenticated;
grant execute on function public.decide_grade_appeal(bigint, boolean, numeric, text, text) to authenticated;
grant execute on function public.my_grade_appeal_credits() to authenticated;
grant execute on function public.my_appealable_marks() to authenticated;

-- ---- The teachers' page ---------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/grade-appeals', 'Mark Appeals', 'Students', 15)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('teacher', '/grade-appeals'),
  ('head_of_department', '/grade-appeals'),
  ('assessment_manager', '/grade-appeals'),
  ('smt', '/grade-appeals')
on conflict do nothing;
