-- Migration 394: the school rating (Worry Box stage 3).
--
-- Why (the principal, 7 Oct 2026: "now do the school rating"): students
-- rate parts of school life from 1 to 5 and can say one thing the school
-- does well and one it could do better. Decisions taken here, to be
-- confirmed with the principal:
--   * About once a term, in rounds the DSL and the principal open on
--     /school-rating (none is opened by this migration: the first wellbeing
--     check-in runs this week).
--   * Students rate from a "Rate the School" tile on their portal while a
--     round is open, once per round. Not a pop-up.
--   * Anonymous to staff: the student is stored only so they can't rate
--     twice. Nobody has a select policy on the rows; the DSL and the
--     principal (can_read_worries(), as for worries and check-ins) see
--     totals through school_rating_summary(), by year group and boarding
--     house only where at least 3 students answered, and the written
--     comments without names, in a mixed-up order, once a round has 3.
--   * Parents see nothing. Nothing is deleted.
-- The areas are data (school_rating_areas); their wording is fixed once
-- rated (retire and add instead).

set local formwork.change_note = 'Principal (direct)';

create table public.school_rating_rounds (
  round_id serial primary key,
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  opens_at timestamptz not null,
  closes_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id),
  check ((opens_at at time zone 'Africa/Lagos')::date <= closes_on)
);

alter table public.school_rating_rounds enable row level security;
grant select on public.school_rating_rounds to authenticated;
create policy school_rating_rounds_read on public.school_rating_rounds
  for select to authenticated using (true);

create table public.school_rating_areas (
  area_id serial primary key,
  position integer not null default 0,
  area text not null check (btrim(area) <> '' and length(area) <= 120),
  description text check (description is null or length(description) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.school_rating_areas enable row level security;
grant select on public.school_rating_areas to authenticated;
create policy school_rating_areas_read on public.school_rating_areas
  for select to authenticated using (true);

insert into public.school_rating_areas (position, area, description) values
  (1,  'Lessons and teaching', 'How good your lessons are and how much you learn'),
  (2,  'Help when you are struggling', 'With work, exams or anything else'),
  (3,  'Feeling safe', 'At school and in the boarding house'),
  (4,  'Being listened to', 'Staff take what you say seriously'),
  (5,  'Life in the boarding house', null),
  (6,  'Food', null),
  (7,  'Classrooms, labs and facilities', null),
  (8,  'Sport, clubs and The Other Half', null),
  (9,  'Knowing what is going on', 'Notices, timetables and changes'),
  (10, 'Overall: would you recommend the school to a friend?', null);

create table public.school_ratings (
  rating_id bigserial primary key,
  round_id integer not null references public.school_rating_rounds(round_id),
  student_id integer not null references public.students(student_id),
  year_group integer,
  boarding_house text,
  does_well text check (does_well is null or length(does_well) <= 1000),
  could_improve text check (could_improve is null or length(could_improve) <= 1000),
  created_at timestamptz not null default now()
);

create unique index school_ratings_once on public.school_ratings (round_id, student_id);

create table public.school_rating_scores (
  score_id bigserial primary key,
  rating_id bigint not null references public.school_ratings(rating_id),
  area_id integer not null references public.school_rating_areas(area_id),
  score integer not null check (score between 1 and 5)
);

create unique index school_rating_scores_once on public.school_rating_scores (rating_id, area_id);

-- No select policy and no grant on the answers: they are read only through
-- school_rating_summary(), so no one can pick out a student's answers.
alter table public.school_ratings enable row level security;
alter table public.school_rating_scores enable row level security;

create trigger trg_school_ratings_keep_forever
  before update or delete on public.school_ratings
  for each row execute function public.worry_keep_forever();
create trigger trg_school_rating_scores_keep_forever
  before update or delete on public.school_rating_scores
  for each row execute function public.worry_keep_forever();

create or replace function public.school_rating_area_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.area is distinct from old.area
     and exists (select 1 from school_rating_scores s where s.area_id = old.area_id) then
    raise exception 'Students have already rated this, so its wording can''t change. Retire it and add a new one.';
  end if;
  return new;
end;
$$;

revoke execute on function public.school_rating_area_guard() from public, anon, authenticated;

create trigger trg_school_rating_area_guard
  before update on public.school_rating_areas
  for each row execute function public.school_rating_area_guard();

-- ---- Students ---------------------------------------------------------------

create or replace function public.school_rating_open_round()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select r.round_id from school_rating_rounds r
  where r.cancelled_at is null and r.opens_at <= now() and school_today() <= r.closes_on
  order by r.opens_at desc
  limit 1;
$$;

revoke execute on function public.school_rating_open_round() from public, anon, authenticated;

-- The open round for the signed-in student, and whether they have rated it.
create or replace function public.my_school_rating()
returns table (round_id integer, round_name text, closes_on date, done boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select r.round_id, r.name, r.closes_on,
         exists (select 1 from school_ratings x where x.round_id = r.round_id and x.student_id = s.student_id)
  from school_rating_rounds r
  join students s on s.student_id = my_student_id() and s.status = 'active'
  where r.round_id = school_rating_open_round();
$$;

revoke execute on function public.my_school_rating() from public, anon;
grant execute on function public.my_school_rating() to authenticated;

-- p_scores: {"<area_id>": 1..5, ...}, every active area.
create or replace function public.give_school_rating(p_scores jsonb, p_does_well text, p_could_improve text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_student students%rowtype;
  v_round integer := school_rating_open_round();
  v_well text := nullif(btrim(coalesce(p_does_well, '')), '');
  v_better text := nullif(btrim(coalesce(p_could_improve, '')), '');
  v_a record;
  v_val jsonb;
  v_key text;
  v_id bigint;
begin
  select * into v_student from students where student_id = my_student_id() and status = 'active';
  if not found then
    raise exception 'Only students can rate the school.';
  end if;
  if v_round is null then
    raise exception 'The school rating isn''t open just now.';
  end if;
  if length(coalesce(v_well, '')) > 1000 or length(coalesce(v_better, '')) > 1000 then
    raise exception 'Please keep each comment under 1000 characters.';
  end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then
    raise exception 'Please rate everything.';
  end if;
  for v_a in select area_id from school_rating_areas where active loop
    v_val := p_scores -> v_a.area_id::text;
    if jsonb_typeof(v_val) is distinct from 'number' or (v_val #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
      raise exception 'Please rate everything.';
    end if;
  end loop;
  for v_key in select jsonb_object_keys(p_scores) loop
    if not exists (select 1 from school_rating_areas where active and area_id::text = v_key) then
      raise exception 'Unknown area in the rating.';
    end if;
  end loop;

  insert into school_ratings (round_id, student_id, year_group, boarding_house, does_well, could_improve)
  values (v_round, v_student.student_id, v_student.year_group, nullif(btrim(v_student.boarding_house), ''), v_well, v_better)
  returning rating_id into v_id;

  insert into school_rating_scores (rating_id, area_id, score)
  select v_id, a.area_id, (p_scores ->> a.area_id::text)::integer
  from school_rating_areas a where a.active;
exception when unique_violation then
  raise exception 'You have already rated the school this time. Thank you.';
end;
$$;

revoke execute on function public.give_school_rating(jsonb, text, text) from public, anon;
grant execute on function public.give_school_rating(jsonb, text, text) to authenticated;

-- ---- The DSL and the principal ----------------------------------------------

-- Totals for a round, as one jsonb:
--   responses, students (active now),
--   areas: [{area_id, area, position, n, average, counts: [n1..n5],
--            by_year: [{year_group, n, average}], by_house: [{house, n, average}]}]
--     (a year or house with fewer than 3 answers shows n only),
--   comments: [{does_well, could_improve}] without names, in a mixed-up
--     order, and only once the round has at least 3 responses.
create or replace function public.school_rating_summary(p_round_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_responses integer;
begin
  if not can_read_worries() then
    return null;
  end if;
  select count(*) into v_responses from school_ratings where round_id = p_round_id;

  return jsonb_build_object(
    'responses', v_responses,
    'students', (select count(*) from students where status = 'active'),
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'area_id', a.area_id, 'area', a.area, 'description', a.description, 'position', a.position,
        'n', t.n, 'average', t.average, 'counts', t.counts,
        'by_year', coalesce((
          select jsonb_agg(jsonb_build_object('year_group', y.year_group, 'n', y.n,
                   'average', case when y.n >= 3 then y.average end) order by y.year_group)
          from (select r.year_group, count(*) as n, round(avg(s.score), 2) as average
                from school_rating_scores s join school_ratings r on r.rating_id = s.rating_id
                where r.round_id = p_round_id and s.area_id = a.area_id
                group by r.year_group) y), '[]'::jsonb),
        'by_house', coalesce((
          select jsonb_agg(jsonb_build_object('house', h.house, 'n', h.n,
                   'average', case when h.n >= 3 then h.average end) order by h.house)
          from (select coalesce(r.boarding_house, 'No house') as house, count(*) as n, round(avg(s.score), 2) as average
                from school_rating_scores s join school_ratings r on r.rating_id = s.rating_id
                where r.round_id = p_round_id and s.area_id = a.area_id
                group by coalesce(r.boarding_house, 'No house')) h), '[]'::jsonb)
      ) order by a.position, a.area_id)
      from school_rating_areas a
      join lateral (
        select count(*) as n, round(avg(s.score), 2) as average,
               jsonb_build_array(
                 count(*) filter (where s.score = 1), count(*) filter (where s.score = 2),
                 count(*) filter (where s.score = 3), count(*) filter (where s.score = 4),
                 count(*) filter (where s.score = 5)) as counts
        from school_rating_scores s join school_ratings r on r.rating_id = s.rating_id
        where r.round_id = p_round_id and s.area_id = a.area_id
      ) t on true
      where a.active or t.n > 0), '[]'::jsonb),
    'comments', case when v_responses >= 3 then coalesce((
      select jsonb_agg(jsonb_build_object('does_well', r.does_well, 'could_improve', r.could_improve)
                       order by md5(r.rating_id::text || 'formwork'))
      from school_ratings r
      where r.round_id = p_round_id and (r.does_well is not null or r.could_improve is not null)), '[]'::jsonb)
      else '[]'::jsonb end);
end;
$$;

revoke execute on function public.school_rating_summary(integer) from public, anon;
grant execute on function public.school_rating_summary(integer) to authenticated;

create or replace function public.add_school_rating_round(p_name text, p_opens_at timestamptz, p_closes_on date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id integer;
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can set school rating dates.';
  end if;
  if p_opens_at is null or p_closes_on is null or (p_opens_at at time zone 'Africa/Lagos')::date > p_closes_on then
    raise exception 'The rating must close on or after the day it opens.';
  end if;
  if p_closes_on < school_today() then
    raise exception 'That rating would already be over.';
  end if;
  if exists (select 1 from school_rating_rounds r
             where r.cancelled_at is null
               and (r.opens_at at time zone 'Africa/Lagos')::date <= p_closes_on
               and (p_opens_at at time zone 'Africa/Lagos')::date <= r.closes_on) then
    raise exception 'Those dates overlap another school rating.';
  end if;
  insert into school_rating_rounds (name, opens_at, closes_on, created_by)
  values (btrim(coalesce(nullif(btrim(p_name), ''), 'School rating')), p_opens_at, p_closes_on, auth.uid())
  returning round_id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.add_school_rating_round(text, timestamptz, date) from public, anon;
grant execute on function public.add_school_rating_round(text, timestamptz, date) to authenticated;

create or replace function public.set_school_rating_round_close(p_round_id integer, p_closes_on date)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can set school rating dates.';
  end if;
  update school_rating_rounds set closes_on = p_closes_on
  where round_id = p_round_id and cancelled_at is null
    and (opens_at at time zone 'Africa/Lagos')::date <= p_closes_on;
  if not found then
    raise exception 'The rating must close on or after the day it opens.';
  end if;
end;
$$;

revoke execute on function public.set_school_rating_round_close(integer, date) from public, anon;
grant execute on function public.set_school_rating_round_close(integer, date) to authenticated;

create or replace function public.cancel_school_rating_round(p_round_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not can_read_worries() then
    raise exception 'Only the DSL and the principal can cancel a school rating.';
  end if;
  if exists (select 1 from school_ratings where round_id = p_round_id) then
    raise exception 'Students have already rated in this one. Close it early instead.';
  end if;
  update school_rating_rounds set cancelled_at = now(), cancelled_by = auth.uid()
  where round_id = p_round_id and cancelled_at is null;
end;
$$;

revoke execute on function public.cancel_school_rating_round(integer) from public, anon;
grant execute on function public.cancel_school_rating_round(integer) to authenticated;

-- ---- The staff page ---------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/school-rating', 'School Rating', 'Pastoral', 29)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('dsl', '/school-rating'),
  ('principal', '/school-rating')
on conflict do nothing;
