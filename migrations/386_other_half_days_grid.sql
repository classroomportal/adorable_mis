-- Which year groups have the Other Half on which days, as a tick grid
-- (the principal, 6 Oct 2026). Migration 384 recorded only Year 12's
-- exception (Mon and Thu); any year without a row could use any day. Now
-- every year has a row, so the grid is the whole rule, and it is checked in
-- three places:
--   * the Other Half: an activity can't be opened to a year on a day it
--     doesn't have OH, and a student can't choose or be placed on one (the
--     384 triggers, unchanged);
--   * the timetable: a lesson can't be put in the OH period on a day that
--     year has OH (new trigger on timetable_slots). The Nova-T import leaves
--     such lessons out and lists them; this is the backstop;
--   * the grid itself: set_other_half_year_days() refuses to untick a day
--     that still has that year's activities or choices, or to tick a day
--     that year has lessons in the OH period.
-- Shown at /other-half/year-days, linked from the Timetable card. Edited by
-- those who manage the Other Half (can_manage_other_half(): SMT, the
-- other_half coordinator, admins), logged in change_history area
-- 'other_half'.
--
-- Seeded from what runs: Years 7-11 Mon-Thu, Year 12 Mon and Thu (Tue and
-- Wed are science lessons). Friday has an OH slot in the bell times but no
-- activities, so it is unticked. No Year 13 yet.
--
-- 109/Pr1 goes. Nova-T's Sports block (Year 10, Tuesday OH period) holds the
-- Sports Academy groups, already skipped as OH (158), and a Prep group for
-- students who don't do sports. That Prep is the OH activity Prep too, which
-- both its students (Munachi Chibueze, Kamsi Joe-Onyekwelu) have chosen and
-- are registered in; the class has no teacher, homework, feedback, covers
-- or behaviour. Its 2 enrolments and 1 lesson go with it.

set local formwork.change_note = 'Principal (direct)';

insert into public.other_half_year_days (year_group, days, reason)
select y, array['Mon', 'Tue', 'Wed', 'Thu'], null
  from generate_series(7, 11) y
on conflict (year_group) do nothing;

alter table public.other_half_year_days
  add column updated_at timestamptz,
  add column updated_by uuid;

alter table public.change_history drop constraint change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area = any (array['registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions',
                           'groups', 'students', 'reading_ages', 'finance', 'prep', 'rewards', 'other_half']));

create trigger trg_log_change
  after insert or update or delete on public.other_half_year_days
  for each row execute function public.log_change('other_half', 'year_group');

-- "no days" rather than a blank in the 384 messages.
create or replace function public.other_half_day_names(p_days text[])
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(string_agg(case d when 'Mon' then 'Mondays' when 'Tue' then 'Tuesdays' when 'Wed' then 'Wednesdays'
                                    when 'Thu' then 'Thursdays' when 'Fri' then 'Fridays' else d end, ' and ' order by ord),
                  'no days')
  from unnest(p_days) with ordinality as t(d, ord);
$$;

create or replace function public.oh_period_number()
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select period_number from periods where short_label = 'OH' limit 1;
$$;

create or replace function public.set_other_half_year_days(p_year_group integer, p_days text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_days text[];
  v_removed text[];
  v_added text[];
  d text;
  n_act integer;
  n_choice integer;
  v_lessons text;
begin
  if not can_manage_other_half() then
    raise exception 'Only those who manage the Other Half can change which days each year has it.';
  end if;
  if p_year_group not between 7 and 13 then
    raise exception 'Year % isn''t a year group here.', p_year_group;
  end if;
  select array_agg(x order by array_position(array['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], x))
    into v_days from (select distinct unnest(coalesce(p_days, '{}')) x) t;
  v_days := coalesce(v_days, '{}');
  if not v_days <@ array['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] then
    raise exception 'Days must be Mon to Fri.';
  end if;

  select array(select unnest(coalesce(days, '{}')) except select unnest(v_days)),
         array(select unnest(v_days) except select unnest(coalesce(days, '{}')))
    into v_removed, v_added
    from other_half_year_days where year_group = p_year_group;
  if not found then
    v_removed := '{}';
    v_added := v_days;
  end if;

  foreach d in array v_removed loop
    select count(*) into n_act from other_half_activities a
     where a.is_active and a.day_of_week = d and p_year_group = any (a.year_groups);
    select count(*) into n_choice from other_half_choices c join students s using (student_id)
     where c.day_of_week = d and s.year_group = p_year_group and s.status = 'active';
    if n_act > 0 or n_choice > 0 then
      raise exception 'Year % still has % activit% and % choice% on %. Take Year % off those activities and move the choices first.',
        p_year_group, n_act, case when n_act = 1 then 'y' else 'ies' end,
        n_choice, case when n_choice = 1 then '' else 's' end,
        other_half_day_names(array[d]), p_year_group;
    end if;
  end loop;

  foreach d in array v_added loop
    select string_agg(distinct c.class_code, ', ') into v_lessons
      from timetable_slots ts join classes c using (class_id)
     where c.year_group = p_year_group and ts.day_of_week = d and ts.period_number = oh_period_number();
    if v_lessons is not null then
      raise exception 'Year % has lessons in the Other Half period on % (%). Move them in Nova-T first.',
        p_year_group, other_half_day_names(array[d]), v_lessons;
    end if;
  end loop;

  insert into other_half_year_days (year_group, days, updated_at, updated_by)
  values (p_year_group, v_days, now(), auth.uid())
  on conflict (year_group) do update
    set days = excluded.days, updated_at = now(), updated_by = auth.uid()
  where other_half_year_days.days is distinct from excluded.days;
end;
$$;
revoke execute on function public.set_other_half_year_days(integer, text[]) from public, anon;
grant execute on function public.set_other_half_year_days(integer, text[]) to authenticated;

-- No lesson in the OH period on a day that year has the Other Half.
create or replace function public.timetable_slot_oh_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_year integer;
begin
  if new.period_number is distinct from oh_period_number() then
    return new;
  end if;
  select c.class_code, c.year_group into v_code, v_year from classes c where c.class_id = new.class_id;
  if exists (select 1 from other_half_year_days y
              where y.year_group = v_year and new.day_of_week = any (y.days)) then
    raise exception '% can''t have a lesson in the Other Half period on %: Year % has the Other Half then. Untick the day at Other Half days, or move the lesson in Nova-T.',
      v_code, other_half_day_names(array[new.day_of_week]), v_year;
  end if;
  return new;
end;
$$;
revoke execute on function public.timetable_slot_oh_check() from public, anon, authenticated;

create trigger trg_timetable_slot_oh_check
  before insert or update of class_id, day_of_week, period_number on public.timetable_slots
  for each row execute function public.timetable_slot_oh_check();

-- 109/Pr1: see above.
delete from public.timetable_slots where class_id = (select class_id from classes where class_code = '109/Pr1');
delete from public.student_class where class_id = (select class_id from classes where class_code = '109/Pr1');
delete from public.classes where class_code = '109/Pr1';

insert into public.resources (resource_key, label, section, sort_order) values
  ('/other-half/year-days', 'Other Half Days', 'Other Half', 64)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key)
select role_name, '/other-half/year-days' from public.role_permissions
 where resource_key = '/other-half/activities'
on conflict do nothing;
