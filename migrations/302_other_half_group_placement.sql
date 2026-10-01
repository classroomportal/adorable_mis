-- Migration 302: put a group of students into an Other Half activity and lock
-- the placement, and a group rule for one subject.
--
-- Why (the principal, 1 Oct 2026): "we need to be able to choose a group of
-- students who are underneath a certain grade or below target in a subject
-- and create a group and then allocate them to the other half group and lock
-- their choice in until we decide or for a certain amount of time". The
-- principal's choices (same day): those who manage the Other Half or manage
-- groups can place and lock; students and parents see only "placed by the
-- school" (with the end date), never why; when a lock ends the placement
-- stays and the student may change it; a full activity or one outside a
-- student's year group gets a warning, then goes ahead.
--
-- Now:
--   1. A new rule for /groups/build, 'subject_grade': in one chosen subject,
--      the latest grade since a chosen date is below a chosen grade
--      ('below_grade') or below the student's target ('below_target').
--      Compared by grade_scale points, a WAEC grade only with a WAEC grade,
--      as the other rules do. The existing five rules are unchanged.
--   2. other_half_choices gains a lock: locked, locked_until (inclusive; null
--      = until staff unlock), locked_by and locked_at (stamped from
--      auth.uid() by a trigger, never taken from the request). While a lock
--      is in force, choose_other_half_activity() and drop_other_half_choice()
--      refuse to change that day (students can't write the table directly).
--      Once a lock's date passes it is no longer in force; the placement
--      stays, and the student's own next choice clears it.
--   3. place_group_in_other_half(group, activity, lock, until): every current
--      student in the group is put in the activity, replacing their choice
--      for that day only, locked or not. unlock_other_half_choices(term, day,
--      students) lifts locks and leaves the placement. Both are allowed to
--      can_place_group_in_other_half(): can_manage_other_half() (smt,
--      other_half, admin) or can_manage_student_groups() (smt, pastoral,
--      school_office, admin). Staff who manage the Other Half can still move
--      anyone at /other-half/choices; a lock stays with the student's day.

set local formwork.change_note = 'Principal (direct)';

-- 1. The subject rule --------------------------------------------------------------------

create or replace function public.student_group_rule_settings(p_rule text, p_settings jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $$
declare
  s jsonb := coalesce(p_settings, '{}'::jsonb);
  v_out jsonb;
  v_from date;
  v_to date;
  v_threshold integer;
  v_min integer;
  v_since date;
  v_percent numeric;
  v_min_sessions integer;
  v_direction text;
  v_exam_date date;
  v_subject integer;
  v_mode text;
  v_grade text;
  k text;
begin
  -- The filters every rule shares: lists of text, empty meaning "all".
  foreach k in array array['year_groups', 'forms', 'houses'] loop
    if s ? k and jsonb_typeof(s->k) <> 'array' then
      raise exception '% must be a list.', k;
    end if;
  end loop;
  v_out := jsonb_build_object(
    'year_groups', coalesce(s->'year_groups', '[]'::jsonb),
    'forms', coalesce(s->'forms', '[]'::jsonb),
    'houses', coalesce(s->'houses', '[]'::jsonb));

  if p_rule = 'negative_behaviour' then
    begin
      v_from := (s->>'from')::date;
      v_to := (s->>'to')::date;
      v_threshold := (s->>'threshold')::integer;
    exception when others then
      raise exception 'Give a start date, an end date and a points threshold.';
    end;
    if v_from is null or v_to is null or v_threshold is null then
      raise exception 'Give a start date, an end date and a points threshold.';
    end if;
    if v_to < v_from then
      raise exception 'The end date is before the start date.';
    end if;
    if v_threshold >= 0 or v_threshold < -1000 then
      raise exception 'The points threshold must be a negative number, e.g. -6.';
    end if;
    return v_out || jsonb_build_object('from', v_from, 'to', v_to, 'threshold', v_threshold);

  elsif p_rule = 'below_target' then
    begin
      v_min := (s->>'min_subjects')::integer;
      v_since := (s->>'since')::date;
    exception when others then
      raise exception 'Give the number of subjects and the date results count from.';
    end;
    if v_min is null or v_since is null then
      raise exception 'Give the number of subjects and the date results count from.';
    end if;
    if v_min < 1 or v_min > 20 then
      raise exception 'The number of subjects must be between 1 and 20.';
    end if;
    return v_out || jsonb_build_object('min_subjects', v_min, 'since', v_since);

  elsif p_rule = 'positive_behaviour' then
    begin
      v_from := (s->>'from')::date;
      v_to := (s->>'to')::date;
      v_threshold := (s->>'threshold')::integer;
    exception when others then
      raise exception 'Give a start date, an end date and a points total.';
    end;
    if v_from is null or v_to is null or v_threshold is null then
      raise exception 'Give a start date, an end date and a points total.';
    end if;
    if v_to < v_from then
      raise exception 'The end date is before the start date.';
    end if;
    if v_threshold <= 0 or v_threshold > 1000 then
      raise exception 'The points total must be a positive number, e.g. 20.';
    end if;
    return v_out || jsonb_build_object('from', v_from, 'to', v_to, 'threshold', v_threshold);

  elsif p_rule = 'term_exam' then
    begin
      v_exam_date := (s->>'exam_date')::date;
      v_percent := (s->>'percent')::numeric;
      v_direction := s->>'direction';
    exception when others then
      raise exception 'Choose a term exam, below or at/above, and a percentage.';
    end;
    if v_exam_date is null or v_percent is null or v_direction is null then
      raise exception 'Choose a term exam, below or at/above, and a percentage.';
    end if;
    if v_direction not in ('below', 'at_or_above') then
      raise exception 'Choose below or at/above.';
    end if;
    if v_percent < 0 or v_percent > 100 then
      raise exception 'The percentage must be between 0 and 100.';
    end if;
    if not exists (select 1 from calendar_events ce where ce.event_date = v_exam_date and ce.exam_term is not null) then
      raise exception 'There is no term exam on that date.';
    end if;
    return v_out || jsonb_build_object('exam_date', v_exam_date, 'direction', v_direction, 'percent', v_percent);

  elsif p_rule = 'attendance' then
    begin
      v_from := (s->>'from')::date;
      v_to := (s->>'to')::date;
      v_percent := (s->>'percent')::numeric;
      v_min_sessions := coalesce((s->>'min_sessions')::integer, 1);
    exception when others then
      raise exception 'Give a start date, an end date, a percentage and the fewest sessions to count.';
    end;
    if v_from is null or v_to is null or v_percent is null then
      raise exception 'Give a start date, an end date, a percentage and the fewest sessions to count.';
    end if;
    if v_to < v_from then
      raise exception 'The end date is before the start date.';
    end if;
    if v_percent <= 0 or v_percent > 100 then
      raise exception 'The percentage must be more than 0 and at most 100.';
    end if;
    if v_min_sessions < 1 or v_min_sessions > 10000 then
      raise exception 'The fewest sessions to count must be at least 1.';
    end if;
    return v_out || jsonb_build_object('from', v_from, 'to', v_to, 'percent', v_percent, 'min_sessions', v_min_sessions);

  elsif p_rule = 'subject_grade' then
    begin
      v_subject := (s->>'subject_id')::integer;
      v_mode := s->>'mode';
      v_grade := nullif(upper(btrim(coalesce(s->>'grade', ''))), '');
      v_since := (s->>'since')::date;
    exception when others then
      raise exception 'Choose a subject, below a grade or below target, and the date results count from.';
    end;
    if v_subject is null or v_mode is null or v_since is null then
      raise exception 'Choose a subject, below a grade or below target, and the date results count from.';
    end if;
    if not exists (select 1 from subjects where subject_id = v_subject) then
      raise exception 'Unknown subject.';
    end if;
    if v_mode not in ('below_grade', 'below_target') then
      raise exception 'Choose below a grade or below target.';
    end if;
    if v_mode = 'below_grade' and (v_grade is null or not exists (select 1 from grade_scale where grade = v_grade)) then
      raise exception 'Choose the grade students are below.';
    end if;
    -- The subject's name is kept with the settings so the group lists can say it.
    return v_out || jsonb_build_object('subject_id', v_subject, 'mode', v_mode, 'since', v_since,
                      'subject_name', (select coalesce(display_name, subject_name) from subjects where subject_id = v_subject))
                 || case when v_mode = 'below_grade' then jsonb_build_object('grade', v_grade) else '{}'::jsonb end;
  end if;

  raise exception 'Unknown rule: %', p_rule;
end;
$$;

revoke execute on function public.student_group_rule_settings(text, jsonb) from public, anon, authenticated;

create or replace function public.student_group_rule_preview(p_rule text, p_settings jsonb)
returns table(student_id integer, first_name text, last_name text, year_group integer, form_class text, score numeric, reason text)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
#variable_conflict use_column
declare
  s jsonb;
begin
  if not can_manage_student_groups() then
    raise exception 'Only SMT, pastoral staff and the school office can build student groups.';
  end if;
  s := student_group_rule_settings(p_rule, p_settings);

  if p_rule = 'negative_behaviour' then
    return query
    with pupils as (
      select st.* from students st
      where st.status = 'active'
        and (jsonb_array_length(s->'year_groups') = 0 or st.year_group::text in (select jsonb_array_elements_text(s->'year_groups')))
        and (jsonb_array_length(s->'forms') = 0 or st.form_class in (select jsonb_array_elements_text(s->'forms')))
        and (jsonb_array_length(s->'houses') = 0 or st.boarding_house in (select jsonb_array_elements_text(s->'houses')))
    ), totals as (
      select b.student_id, sum(b.points) as pts, count(*) as n
      from behaviour_events b
      join pupils p on p.student_id = b.student_id
      where b.type = 'negative' and b.voided_at is null
        and b.event_date between (s->>'from')::date and (s->>'to')::date
      group by b.student_id
    )
    select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class, t.pts::numeric,
           format('%s points in %s negative event%s', t.pts, t.n, case when t.n = 1 then '' else 's' end)
    from totals t join pupils p on p.student_id = t.student_id
    where t.pts <= (s->>'threshold')::integer
    order by t.pts, p.last_name, p.first_name;

  elsif p_rule = 'below_target' then
    return query
    with pupils as (
      select st.* from students st
      where st.status = 'active'
        and (jsonb_array_length(s->'year_groups') = 0 or st.year_group::text in (select jsonb_array_elements_text(s->'year_groups')))
        and (jsonb_array_length(s->'forms') = 0 or st.form_class in (select jsonb_array_elements_text(s->'forms')))
        and (jsonb_array_length(s->'houses') = 0 or st.boarding_house in (select jsonb_array_elements_text(s->'houses')))
    ), latest as (
      -- The most recent graded result in each subject since the chosen date.
      select distinct on (r.student_id, r.subject_id) r.student_id, r.subject_id, upper(btrim(r.grade)) as grade
      from results r
      join pupils p on p.student_id = r.student_id
      where r.grade is not null and btrim(r.grade) <> ''
        and r.week_start_date >= (s->>'since')::date
      order by r.student_id, r.subject_id, r.week_start_date desc, r.result_id desc
    ), compared as (
      select l.student_id, coalesce(sub.display_name, sub.subject_name) as subject, l.grade, upper(btrim(t.target_grade)) as target
      from latest l
      join target_grades t on t.student_id = l.student_id and t.subject_id = l.subject_id
      join subjects sub on sub.subject_id = l.subject_id
      join grade_scale ga on ga.grade = l.grade
      join grade_scale gt on gt.grade = upper(btrim(t.target_grade))
      -- WAEC grades are only compared with WAEC targets (lib/gradeCompare.js).
      where (l.grade in ('A1+', 'A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'))
          = (upper(btrim(t.target_grade)) in ('A1+', 'A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'))
        and ga.points < gt.points
    ), counted as (
      select c.student_id, count(*) as n,
             string_agg(format('%s (%s, target %s)', c.subject, c.grade, c.target), ', ' order by c.subject) as detail
      from compared c
      group by c.student_id
    )
    select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class, c.n::numeric,
           format('Below target in %s subject%s: %s', c.n, case when c.n = 1 then '' else 's' end, c.detail)
    from counted c join pupils p on p.student_id = c.student_id
    where c.n >= (s->>'min_subjects')::integer
    order by c.n desc, p.last_name, p.first_name;

  elsif p_rule = 'positive_behaviour' then
    return query
    with pupils as (
      select st.* from students st
      where st.status = 'active'
        and (jsonb_array_length(s->'year_groups') = 0 or st.year_group::text in (select jsonb_array_elements_text(s->'year_groups')))
        and (jsonb_array_length(s->'forms') = 0 or st.form_class in (select jsonb_array_elements_text(s->'forms')))
        and (jsonb_array_length(s->'houses') = 0 or st.boarding_house in (select jsonb_array_elements_text(s->'houses')))
    ), totals as (
      select b.student_id, sum(b.points) as pts, count(*) as n
      from behaviour_events b
      join pupils p on p.student_id = b.student_id
      where b.type = 'positive' and b.voided_at is null
        and b.event_date between (s->>'from')::date and (s->>'to')::date
      group by b.student_id
    )
    select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class, t.pts::numeric,
           format('+%s points in %s positive event%s', t.pts, t.n, case when t.n = 1 then '' else 's' end)
    from totals t join pupils p on p.student_id = t.student_id
    where t.pts >= (s->>'threshold')::integer
    order by t.pts desc, p.last_name, p.first_name;

  elsif p_rule = 'term_exam' then
    return query
    with pupils as (
      select st.* from students st
      where st.status = 'active'
        and (jsonb_array_length(s->'year_groups') = 0 or st.year_group::text in (select jsonb_array_elements_text(s->'year_groups')))
        and (jsonb_array_length(s->'forms') = 0 or st.form_class in (select jsonb_array_elements_text(s->'forms')))
        and (jsonb_array_length(s->'houses') = 0 or st.boarding_house in (select jsonb_array_elements_text(s->'houses')))
    ), marks as (
      -- Every percentage mark in that term's exam sets (one set per year
      -- group, all on the same date). A student only has marks in the set of
      -- the year group they were in then, so no year mapping is needed.
      select r.student_id, max(ce.event_name) as exam,
             avg(r.score * 100 / coalesce(nullif(r.max_score, 0), 100)) as pct, count(*) as n
      from results r
      join calendar_events ce on ce.event_id = r.result_set_event_id
      join pupils p on p.student_id = r.student_id
      where ce.exam_term is not null and ce.event_date = (s->>'exam_date')::date
        and r.score is not null
      group by r.student_id
    )
    select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class, round(m.pct, 1),
           format('Average %s%% over %s subject%s (%s)', round(m.pct, 1), m.n, case when m.n = 1 then '' else 's' end, m.exam)
    from marks m join pupils p on p.student_id = m.student_id
    where case when s->>'direction' = 'below' then m.pct < (s->>'percent')::numeric
               else m.pct >= (s->>'percent')::numeric end
    order by case when s->>'direction' = 'below' then m.pct else -m.pct end, p.last_name, p.first_name;

  elsif p_rule = 'attendance' then
    return query
    with pupils as (
      select st.* from students st
      where st.status = 'active'
        and (jsonb_array_length(s->'year_groups') = 0 or st.year_group::text in (select jsonb_array_elements_text(s->'year_groups')))
        and (jsonb_array_length(s->'forms') = 0 or st.form_class in (select jsonb_array_elements_text(s->'forms')))
        and (jsonb_array_length(s->'houses') = 0 or st.boarding_house in (select jsonb_array_elements_text(s->'houses')))
    ), marks as (
      -- Counted as the portals count it: present or late, out of every mark.
      select a.student_id, count(*) as sessions,
             count(*) filter (where a.status in ('present', 'late')) as attended,
             count(*) filter (where a.status = 'absent') as absent,
             count(*) filter (where a.status = 'authorized_absence') as authorised,
             count(*) filter (where a.status = 'late') as late
      from attendance a
      join pupils p on p.student_id = a.student_id
      where a.attend_date between (s->>'from')::date and (s->>'to')::date
      group by a.student_id
    )
    select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class,
           round(m.attended * 100.0 / m.sessions, 1),
           format('%s%% (%s of %s sessions; %s absent, %s authorised absence, %s late)',
                  round(m.attended * 100.0 / m.sessions, 1), m.attended, m.sessions, m.absent, m.authorised, m.late)
    from marks m join pupils p on p.student_id = m.student_id
    where m.sessions >= (s->>'min_sessions')::integer
      and m.attended * 100.0 / m.sessions < (s->>'percent')::numeric
    order by m.attended * 1.0 / m.sessions, p.last_name, p.first_name;

  elsif p_rule = 'subject_grade' then
    return query
    with pupils as (
      select st.* from students st
      where st.status = 'active'
        and (jsonb_array_length(s->'year_groups') = 0 or st.year_group::text in (select jsonb_array_elements_text(s->'year_groups')))
        and (jsonb_array_length(s->'forms') = 0 or st.form_class in (select jsonb_array_elements_text(s->'forms')))
        and (jsonb_array_length(s->'houses') = 0 or st.boarding_house in (select jsonb_array_elements_text(s->'houses')))
    ), latest as (
      -- The most recent graded result in the subject since the chosen date.
      select distinct on (r.student_id) r.student_id, upper(btrim(r.grade)) as grade
      from results r
      join pupils p on p.student_id = r.student_id
      where r.subject_id = (s->>'subject_id')::integer
        and r.grade is not null and btrim(r.grade) <> ''
        and r.week_start_date >= (s->>'since')::date
      order by r.student_id, r.week_start_date desc, r.result_id desc
    ), compared as (
      -- Compared by grade_scale points, a WAEC grade only with a WAEC grade
      -- (as below_target and lib/gradeCompare.js do).
      select l.student_id, l.grade,
             case when s->>'mode' = 'below_target' then upper(btrim(t.target_grade)) else s->>'grade' end as bar
      from latest l
      left join target_grades t on t.student_id = l.student_id and t.subject_id = (s->>'subject_id')::integer
    )
    select p.student_id, p.first_name, p.last_name, p.year_group, p.form_class, ga.points::numeric,
           case when s->>'mode' = 'below_target'
                then format('%s: %s (target %s)', (select coalesce(display_name, subject_name) from subjects where subject_id = (s->>'subject_id')::integer), c.grade, c.bar)
                else format('%s: %s, below %s', (select coalesce(display_name, subject_name) from subjects where subject_id = (s->>'subject_id')::integer), c.grade, c.bar) end
    from compared c
    join pupils p on p.student_id = c.student_id
    join grade_scale ga on ga.grade = c.grade
    join grade_scale gb on gb.grade = c.bar
    where (c.grade in ('A1+', 'A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9')) = (c.bar in ('A1+', 'A1', 'B2', 'B3', 'C4', 'C5', 'C6', 'D7', 'E8', 'F9'))
      and ga.points < gb.points
    order by ga.points, p.last_name, p.first_name;
  end if;
end;
$$;

revoke execute on function public.student_group_rule_preview(text, jsonb) from public, anon;
grant execute on function public.student_group_rule_preview(text, jsonb) to authenticated;

-- 2. Locked Other Half placements ---------------------------------------------------------

alter table public.other_half_choices
  add column if not exists locked boolean not null default false,
  add column if not exists locked_until date,
  add column if not exists locked_by uuid,
  add column if not exists locked_at timestamptz;

comment on column public.other_half_choices.locked is
  'Placed by the school and locked (migration 302): the student can''t change or drop this day''s choice while the lock is in force.';
comment on column public.other_half_choices.locked_until is
  'Last day of the lock (inclusive). Null with locked = true means until staff unlock it.';

-- Whether a lock is in force today. A lock whose date has passed is simply
-- not in force: the placement stays and the student may change it.
create or replace function public.other_half_lock_in_force(p_locked boolean, p_until date)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(p_locked, false) and (p_until is null or p_until >= school_today());
$$;

grant execute on function public.other_half_lock_in_force(boolean, date) to authenticated;

-- Who locked it and when come from the database, never the request; an
-- unlocked row carries no lock details.
create or replace function public.other_half_choice_lock_stamp()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if not new.locked then
    new.locked_until := null;
    new.locked_by := null;
    new.locked_at := null;
  elsif tg_op = 'INSERT' or not old.locked or new.locked_until is distinct from old.locked_until then
    new.locked_by := auth.uid();
    new.locked_at := now();
  else
    new.locked_by := old.locked_by;
    new.locked_at := old.locked_at;
  end if;
  return new;
end;
$$;

create or replace trigger trg_other_half_choice_lock_stamp before insert or update on public.other_half_choices
  for each row execute function public.other_half_choice_lock_stamp();

-- Students: refuse a change or a drop while the day's lock is in force. The
-- bodies are otherwise as before; a student's own choice clears an expired lock.
create or replace function public.choose_other_half_activity(p_activity_id bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student integer;
  v_year integer;
  a other_half_activities%rowtype;
  n integer;
begin
  select student_id into v_student
    from profiles where id = auth.uid() and role = 'student';
  if v_student is null then
    raise exception 'Only a student account can choose an Other Half activity';
  end if;
  if not in_evening_prep() then
    raise exception 'You can only change your Other Half choices during Evening Prep';
  end if;

  -- Locking the activity row serialises everyone choosing it at once, so
  -- the capacity count below can't be raced past.
  select * into a from other_half_activities where activity_id = p_activity_id for update;
  if not found or not a.is_active then
    raise exception 'That activity is not available';
  end if;
  if not other_half_choices_open(a.term_id) then
    raise exception 'Other Half choices are closed';
  end if;

  if exists (select 1 from other_half_choices c
             where c.student_id = v_student and c.term_id = a.term_id and c.day_of_week = a.day_of_week
               and other_half_lock_in_force(c.locked, c.locked_until)) then
    raise exception 'The school has placed you in an activity on this day, so you can''t change it yet';
  end if;

  select year_group into v_year from students where student_id = v_student and status = 'active';
  if v_year is null or not (v_year = any (a.year_groups)) then
    raise exception 'That activity is not open to your year group';
  end if;

  if a.capacity is not null then
    select count(*) into n from other_half_choices
     where activity_id = a.activity_id and student_id <> v_student;
    if n >= a.capacity then
      raise exception 'Sorry, % is full', a.activity_name;
    end if;
  end if;

  insert into other_half_choices (student_id, activity_id, chosen_by)
  values (v_student, a.activity_id, auth.uid())
  on conflict (student_id, term_id, day_of_week)
  do update set activity_id = excluded.activity_id,
                chosen_at = now(),
                chosen_by = excluded.chosen_by,
                locked = false;
end;
$function$;

create or replace function public.drop_other_half_choice(p_term_id integer, p_day_of_week text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student integer;
begin
  select student_id into v_student
    from profiles where id = auth.uid() and role = 'student';
  if v_student is null then
    raise exception 'Only a student account can change its own Other Half choice';
  end if;
  if not in_evening_prep() then
    raise exception 'You can only change your Other Half choices during Evening Prep';
  end if;
  if not other_half_choices_open(p_term_id) then
    raise exception 'Other Half choices are closed';
  end if;
  if exists (select 1 from other_half_choices c
             where c.student_id = v_student and c.term_id = p_term_id and c.day_of_week = p_day_of_week
               and other_half_lock_in_force(c.locked, c.locked_until)) then
    raise exception 'The school has placed you in an activity on this day, so you can''t change it yet';
  end if;
  delete from other_half_choices
   where student_id = v_student and term_id = p_term_id and day_of_week = p_day_of_week;
end;
$function$;

-- 3. Placing a group, and unlocking -------------------------------------------------------

-- Those who manage the Other Half or manage groups (the principal's choice).
create or replace function public.can_place_group_in_other_half()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select can_manage_other_half() or can_manage_student_groups();
$$;

revoke execute on function public.can_place_group_in_other_half() from public, anon;
grant execute on function public.can_place_group_in_other_half() to authenticated;

-- Puts every current student in the group into the activity, replacing their
-- choice for that day (other days are untouched), optionally locked: until
-- staff unlock it (p_lock and no date) or to the end of p_locked_until.
-- Capacity and year groups are not enforced (the page warns first, as when
-- placing by hand at /other-half/choices).
create or replace function public.place_group_in_other_half(
  p_group_id bigint, p_activity_id bigint, p_lock boolean, p_locked_until date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a other_half_activities%rowtype;
  n integer;
begin
  if not can_place_group_in_other_half() then
    raise exception 'Only SMT, pastoral staff, the school office and the Other Half coordinator can place a group in the Other Half.';
  end if;
  if not exists (select 1 from student_groups g where g.group_id = p_group_id and g.archived_at is null) then
    raise exception 'That group doesn''t exist or is archived.';
  end if;
  select * into a from other_half_activities where activity_id = p_activity_id for update;
  if not found or not a.is_active then
    raise exception 'That activity is not available.';
  end if;
  if p_lock and p_locked_until is not null and p_locked_until < school_today() then
    raise exception 'The lock end date is in the past.';
  end if;

  insert into other_half_choices (student_id, activity_id, chosen_by, locked, locked_until)
  select gm.student_id, a.activity_id, auth.uid(), coalesce(p_lock, false), case when p_lock then p_locked_until end
  from student_group_members gm
  join students s on s.student_id = gm.student_id and s.status = 'active'
  where gm.group_id = p_group_id
  on conflict (student_id, term_id, day_of_week)
  do update set activity_id = excluded.activity_id,
                chosen_at = now(),
                chosen_by = excluded.chosen_by,
                locked = excluded.locked,
                locked_until = excluded.locked_until;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.place_group_in_other_half(bigint, bigint, boolean, date) from public, anon;
grant execute on function public.place_group_in_other_half(bigint, bigint, boolean, date) to authenticated;

-- Unlocks these students' choices for one Other Half term and day. The
-- placement stays; the student can change it at the next Evening Prep while
-- choices are open (the principal's choice).
create or replace function public.unlock_other_half_choices(p_term_id integer, p_day_of_week text, p_student_ids integer[])
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  n integer;
begin
  if not can_place_group_in_other_half() then
    raise exception 'Only SMT, pastoral staff, the school office and the Other Half coordinator can unlock Other Half placements.';
  end if;
  update other_half_choices c set locked = false
  where c.term_id = p_term_id and c.day_of_week = p_day_of_week
    and c.student_id = any (p_student_ids) and c.locked;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.unlock_other_half_choices(integer, text, integer[]) from public, anon;
grant execute on function public.unlock_other_half_choices(integer, text, integer[]) to authenticated;
