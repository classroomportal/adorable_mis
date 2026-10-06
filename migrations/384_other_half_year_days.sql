-- Year 12 have timetabled lessons in the OH period on Tuesdays and
-- Wednesdays (12a/Bi1, 12a/Ch2, 12a/Bi2, 12a/Ph1), so they only do the Other
-- Half on Mondays and Thursdays (the principal, 6 Oct 2026). Nothing enforced
-- that: A Level Maths and Math Catch-up: KS4 on Tuesday were open to Years
-- 11-12, nine Year 12 students chose them, and their OH teacher's register
-- listed students who were in lessons, so they were marked absent.
--
-- other_half_year_days holds the rule as data: a year group with a row may
-- only have OH on the days listed; a year group without one may use any day.
-- Two triggers apply it:
--   * other_half_activities: an activity can't be opened to a year group on a
--     day that year doesn't have OH, so students never see it;
--   * other_half_choices: a choice or a group placement
--     (place_group_in_other_half(), which doesn't check year groups) can't
--     put a student on such a day. Named to run after
--     trg_other_half_choice_from_activity, which fills in day_of_week.
-- Then Year 12 come off the two Tuesday activities and their Tuesday choices
-- are removed (they were never in those activities; their lessons are).
--
-- The table has no write grant: change it in a migration or the SQL editor.

set local formwork.change_note = 'Principal (direct)';

create table public.other_half_year_days (
  year_group integer primary key,
  days text[] not null check (days <@ array['Mon', 'Tue', 'Wed', 'Thu', 'Fri']),
  reason text
);
alter table public.other_half_year_days enable row level security;
grant select on public.other_half_year_days to authenticated;
create policy other_half_year_days_read on public.other_half_year_days
  for select to authenticated using (true);

insert into public.other_half_year_days (year_group, days, reason)
values (12, array['Mon', 'Thu'], 'Year 12 have timetabled lessons in the OH period on the other days');

create or replace function public.other_half_day_names(p_days text[])
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select string_agg(case d when 'Mon' then 'Mondays' when 'Tue' then 'Tuesdays' when 'Wed' then 'Wednesdays'
                           when 'Thu' then 'Thursdays' when 'Fri' then 'Fridays' else d end, ' and ' order by ord)
  from unnest(p_days) with ordinality as t(d, ord);
$$;

-- Year 12 off the Tuesday activities (both open to Years 11-12).
update public.other_half_activities a
   set year_groups = array_remove(a.year_groups, y.year_group)
  from public.other_half_year_days y
 where y.year_group = any (a.year_groups)
   and not (a.day_of_week = any (y.days));

-- Their choices on days they have lessons.
delete from public.other_half_choices c
 using public.students s, public.other_half_year_days y
 where s.student_id = c.student_id
   and y.year_group = s.year_group
   and not (c.day_of_week = any (y.days));

create or replace function public.other_half_activity_year_days_check()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  y other_half_year_days%rowtype;
begin
  select * into y from other_half_year_days
   where year_group = any (new.year_groups) and not (new.day_of_week = any (days))
   order by year_group limit 1;
  if found then
    raise exception 'Year % only has the Other Half on %, so this activity can''t be open to Year % on %.',
      y.year_group, other_half_day_names(y.days), y.year_group, other_half_day_names(array[new.day_of_week]);
  end if;
  return new;
end;
$$;

create trigger trg_other_half_activity_year_days
  before insert or update of year_groups, day_of_week on public.other_half_activities
  for each row execute function public.other_half_activity_year_days_check();

create or replace function public.other_half_choice_year_days_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_name text;
  v_days text[];
begin
  select s.year_group, s.first_name || ' ' || s.last_name, y.days
    into v_year, v_name, v_days
    from students s join other_half_year_days y on y.year_group = s.year_group
   where s.student_id = new.student_id;
  if v_days is not null and not (new.day_of_week = any (v_days)) then
    raise exception '% is in Year %, which only has the Other Half on %.', v_name, v_year, other_half_day_names(v_days);
  end if;
  return new;
end;
$$;
revoke execute on function public.other_half_choice_year_days_check() from public, anon, authenticated;

create trigger trg_other_half_choice_year_days
  before insert or update of activity_id, student_id on public.other_half_choices
  for each row execute function public.other_half_choice_year_days_check();
