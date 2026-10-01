-- Migration 301: student groups built by rule: three more rules (positive
-- behaviour, term exam average, attendance).
--
-- Why (the principal, 1 Oct 2026: "build the other three group rules"): the
-- design (docs/student-groups-design.md) listed five rules; migration 285
-- built the first two. As with those, every setting is chosen by the person
-- building the list each time (the principal: "system build parameters must
-- be editable"); the form only has starting values. The lists are dated,
-- staff-only snapshots exactly as before: build_student_group() is unchanged
-- and still re-runs the preview, so only students the rule picks can be saved.
--
-- New rules in student_group_rule_settings() / student_group_rule_preview():
--   * 'positive_behaviour': positive points between two dates at or above a
--     chosen total (withdrawn events don't count). Settings: from, to,
--     threshold (a positive number). For rewards and certificates.
--   * 'term_exam': a student's average percentage across their subjects in
--     one term exam, below, or at or above, a chosen mark. The exam is chosen
--     by its date: each term's exams are one result set per year group, all
--     on the same date (migration 246), and a student only has marks in their
--     own year group's set, so last year's exams work for students who have
--     since moved up. Marks without a score are skipped. Settings: exam_date,
--     direction ('below' | 'at_or_above'), percent.
--   * 'attendance': present or late as a percentage of every register mark
--     between two dates (the same sum the parent portal shows), below a
--     chosen percentage. Students with fewer marks than a chosen number are
--     left out, so one missed lesson in a week with one mark isn't 0%.
--     Settings: from, to, percent, min_sessions.
-- All three can be narrowed by year group, form and boarding house, and only
-- ever pick current students, like the first two. The two existing rules are
-- unchanged.

-- 1. Checking and reading the settings -------------------------------------------------

create or replace function public.student_group_rule_settings(p_rule text, p_settings jsonb)
returns jsonb
language plpgsql
-- stable, no longer immutable: the term exam rule checks calendar_events.
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
  end if;

  raise exception 'Unknown rule: %', p_rule;
end;
$$;

revoke execute on function public.student_group_rule_settings(text, jsonb) from public, anon, authenticated;

-- 2. The preview -------------------------------------------------------------------------

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
  end if;
end;
$$;

revoke execute on function public.student_group_rule_preview(text, jsonb) from public, anon;
grant execute on function public.student_group_rule_preview(text, jsonb) to authenticated;
