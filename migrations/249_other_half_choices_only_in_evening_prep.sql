-- Migration 249: students can change their Other Half choices only during
-- Evening Prep.
--
-- Why: the school wants students choosing activities in prep, where staff are
-- on hand, not in lessons or from home late at night. Until now a student
-- could choose or drop an activity at any time while the term's choices were
-- open (migration 156).
--
-- choose_other_half_activity() and drop_other_half_choice() — the only way a
-- student can write a choice — now also require it to be Evening Prep right
-- now at the school. The window is whatever Bell Times (/admin/bell-times,
-- the bell_times table behind the school_day view) says Evening Prep is for
-- today: the row with short_label 'EP', from its start time up to its end
-- time (19:00–20:00 every weekday at the time of writing). Moving prep in
-- Bell Times moves the window with it, and a day with no prep row has no
-- window. Found by short label, never by period number, the same as the OH
-- period. The term's choices window (open/close) still applies on top.
--
-- Staff are unaffected: the coordinator and SMT still place and move students
-- at any time from /other-half/choices, which writes the table directly under
-- manage_other_half_choices, not through these functions.

set local formwork.change_note = 'Principal (direct)';

create or replace function in_evening_prep()
returns boolean
language sql stable
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from school_day sd
     where sd.short_label = 'EP'
       and sd.day_of_week = to_char(school_now(), 'Dy')
       and school_now()::time >= sd.start_time
       and school_now()::time < sd.end_time);
$$;

grant execute on function in_evening_prep() to authenticated;

create or replace function choose_other_half_activity(p_activity_id bigint)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
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
                chosen_by = excluded.chosen_by;
end;
$$;

create or replace function drop_other_half_choice(p_term_id integer, p_day_of_week text)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
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
  delete from other_half_choices
   where student_id = v_student and term_id = p_term_id and day_of_week = p_day_of_week;
end;
$$;
