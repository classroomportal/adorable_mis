-- Migration 285: student groups, stage 2: groups the system builds from a
-- rule, with every setting chosen by the person building it.
--
-- Why (the principal, 30 Sept 2026): the school wants lists built from
-- behaviour and academic progress, as a dated snapshot, and "system build
-- parameters must be editable": the thresholds, dates and year groups are
-- chosen each time a list is built, never fixed in the code. The design is in
-- docs/student-groups-design.md; the first two rules are the principal's
-- choice.
--
-- Now:
--   * student_group_rule_preview(rule, settings): the students a rule picks
--     today, each with the reason ("−9 in 4 events"). Nothing is saved.
--       - 'negative_behaviour': negative points in a date range at or below a
--         threshold (withdrawn events don't count). Settings: from, to,
--         threshold (a negative number of points).
--       - 'below_target': latest grade below target in at least N subjects,
--         counting only results on or after a date. Grades are compared by
--         grade_scale points, and a WAEC grade is only compared with a WAEC
--         target, exactly as lib/gradeCompare.js does on the pages. Settings:
--         min_subjects, since.
--       - Both can be narrowed by year_groups, forms and houses. Only current
--         students are ever picked.
--   * build_student_group(name, description, kind, rule, settings, students):
--     saves the list as a group, stamped with the rule, its settings and
--     today's date (Lagos). The students must be ones the rule picks now, so
--     the builder can untick students but not slip others in. The group is
--     staff-only (migration 284's check) and can be changed by hand afterwards
--     like any group. "Build again" starts a new dated group; the old one is
--     never changed.
--   * A group with a rule can only be made through build_student_group(): the
--     insert policy now refuses a rule_type from the app, so a list can't
--     claim a rule it wasn't built from.
--   * Both functions check the caller first (can_manage_student_groups()).

-- 1. Checking and reading the settings -------------------------------------------------

create or replace function public.student_group_rule_settings(p_rule text, p_settings jsonb)
returns jsonb
language plpgsql
immutable
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
  end if;
end;
$$;

revoke execute on function public.student_group_rule_preview(text, jsonb) from public, anon;
grant execute on function public.student_group_rule_preview(text, jsonb) to authenticated;

-- 3. Saving the list as a group ------------------------------------------------------------

create or replace function public.build_student_group(
  p_name text, p_description text, p_kind text, p_rule text, p_settings jsonb, p_student_ids integer[])
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_settings jsonb;
  v_group_id bigint;
  v_bad integer;
begin
  if not can_manage_student_groups() then
    raise exception 'Only SMT, pastoral staff and the school office can build student groups.';
  end if;
  v_settings := student_group_rule_settings(p_rule, p_settings);

  if coalesce(cardinality(p_student_ids), 0) = 0 then
    raise exception 'Choose at least one student.';
  end if;

  -- Only students the rule picks today.
  select count(*) into v_bad
  from unnest(p_student_ids) x(id)
  where x.id not in (select pv.student_id from student_group_rule_preview(p_rule, v_settings) pv);
  if v_bad > 0 then
    raise exception '% of the students chosen no longer match the rule. Show the list again and save.', v_bad;
  end if;

  insert into student_groups (name, description, kind, visibility, rule_type, rule_settings, built_on)
  values (p_name, p_description, coalesce(p_kind, 'intervention'), 'staff', p_rule, v_settings, school_today())
  returning group_id into v_group_id;

  insert into student_group_members (group_id, student_id)
  select v_group_id, x.id from (select distinct unnest(p_student_ids) as id) x;

  return v_group_id;
end;
$$;

revoke execute on function public.build_student_group(text, text, text, text, jsonb, integer[]) from public, anon;
grant execute on function public.build_student_group(text, text, text, text, jsonb, integer[]) to authenticated;

-- 4. A rule only through build_student_group() ---------------------------------------------

drop policy if exists student_groups_manage_insert on public.student_groups;
create policy student_groups_manage_insert on public.student_groups
  for insert with check (can_manage_student_groups() and archived_at is null
                         and rule_type is null and rule_settings is null and built_on is null);
