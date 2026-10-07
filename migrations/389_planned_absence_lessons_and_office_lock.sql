-- Migration 389: planned absences from a lesson to a lesson, and codes only
-- the office can change.
--
-- Why (the principal, 7 Oct 2026): "We need to be able to choose from a lesson
-- to a lesson on a particular day and edit a code that can only be edited by
-- the office". Until now a planned absence (migration 318) always covered
-- whole days, so a student going to a dental appointment for Periods 3 to 5
-- had to be marked in each register by hand; its code could not be changed
-- once saved (only cancelled and re-entered); and a teacher saving the
-- register made the mark theirs, free to change.
--
-- The principal's choices:
--   * A planned absence can start at a chosen lesson on its first day and end
--     at a chosen lesson on its last day. One day, Period 3 to Period 5, works;
--     so does "leaves after Period 4 on Monday, back at Period 2 on Wednesday".
--     Leaving the lesson empty means the whole day, as before. Periods are
--     compared by period_number, which runs in time order on every day
--     (Registration 1 ... Other Half 8, Evening Prep 9).
--   * The office (school_office or attendance_officer, and admin) can change
--     the code of an existing planned absence; every mark it filled in changes
--     with it. Pastoral and SMT keep adding, ending and cancelling.
--   * Teachers can no longer change or delete a planned-absence mark on their
--     register: it stays the absence's, and only the office can change it.
--     The office changing one on a register makes it an ordinary mark again.
--     This replaces 318's rule that saving a register made the mark the
--     teacher's.
--
-- Because a teacher can no longer save over a planned mark, a lesson where
-- every student on roll has a planned-absence mark (a whole class on a visit)
-- would have stayed on Registers Not Done and given the teacher the
-- 10-minute pop-up for ever. Both now count a register as taken once every
-- active student in it has a mark, planned or not; a planned-absence mark
-- alone still doesn't count while anyone is unmarked.
--
-- Now:
--   1. planned_absences.start_period / end_period (null = whole day), checked
--      against periods.
--   2. is_attendance_office(): school_office, attendance_officer or admin.
--   3. planned_absence_apply_days() leaves out periods before start_period on
--      the first day and after end_period on the last.
--   4. plan_absence() and end_planned_absence_from() take the lessons;
--      change_planned_absence_code() is new. The 318 functions
--      add_planned_absence() and end_planned_absence() are no longer callable
--      from the app, so there is one way in.
--   5. attendance_planned_link_guard() refuses a change to, or deletion of, a
--      planned-absence mark from anyone but the office.
--   6. registers_not_done and my_register_reminders() as described above.

set local formwork.change_note = 'Principal (direct)';

-- 1. The lessons ----------------------------------------------------------------------------
-- Written to be safe to run twice (sections 1-3 went in through the connector
-- first; the rest needed the SQL editor).
alter table public.planned_absences
  add column if not exists start_period integer references public.periods(period_number),
  add column if not exists end_period integer references public.periods(period_number);

alter table public.planned_absences
  drop constraint if exists planned_absences_one_day_periods_check;
alter table public.planned_absences
  add constraint planned_absences_one_day_periods_check
  check (start_date <> end_date or start_period is null or end_period is null or end_period >= start_period);

-- 2. Who the office is ----------------------------------------------------------------------
create or replace function public.is_attendance_office()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select has_staff_role(array['school_office', 'attendance_officer']) or is_admin();
$$;

revoke execute on function public.is_attendance_office() from public, anon;
grant execute on function public.is_attendance_office() to authenticated;

-- 3. Writing the marks ----------------------------------------------------------------------
-- As 318, with the two period filters added.
create or replace function public.planned_absence_apply_days(p_id bigint, p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r planned_absences%rowtype;
  v_status text;
  v_day date;
  v_dow text;
  v_added integer := 0;
  v_n integer;
begin
  select * into r from planned_absences where id = p_id and cancelled_at is null;
  if not found then
    return 0;
  end if;
  if not exists (select 1 from students s where s.student_id = r.student_id and s.status = 'active') then
    return 0;
  end if;
  select ac.status into v_status from attendance_codes ac where ac.code = r.code;

  for v_day in
    select gs::date
      from generate_series(greatest(p_from, r.start_date),
                           least(p_to, r.end_date, school_today()),
                           interval '1 day') gs
  loop
    continue when not exists (select 1 from terms t where v_day between t.start_date and t.end_date);
    continue when exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = v_day);
    v_dow := to_char(v_day, 'Dy');

    insert into attendance (student_id, attend_date, period_number, code, status, planned_absence_id, other_half_activity_id)
    select r.student_id, v_day, x.period_number, r.code, v_status, r.id, x.activity_id
      from (
        select ts.period_number, null::bigint as activity_id
          from student_class sc
          join timetable_slots ts on ts.class_id = sc.class_id and ts.day_of_week = v_dow
         where sc.student_id = r.student_id
           and coalesce(sc.joined_on, v_day) <= v_day
        union
        select sd.period_number, ch.activity_id
          from other_half_choices ch
          join other_half_activities a on a.activity_id = ch.activity_id
          join terms t on t.term_id = a.term_id
          join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
         where ch.student_id = r.student_id
           and a.is_active
           and a.day_of_week = v_dow
           and v_day between t.start_date and t.end_date
      ) x
     where (v_day <> r.start_date or r.start_period is null or x.period_number >= r.start_period)
       and (v_day <> r.end_date or r.end_period is null or x.period_number <= r.end_period)
    on conflict (student_id, attend_date, period_number) do nothing;

    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return v_added;
end;
$$;

revoke execute on function public.planned_absence_apply_days(bigint, date, date) from public, anon, authenticated;

-- 4. Adding, ending, changing the code ------------------------------------------------------
create or replace function public.plan_absence(
  p_student_id integer,
  p_start date,
  p_end date,
  p_code text,
  p_notes text default null,
  p_start_period integer default null,
  p_end_period integer default null
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_clash planned_absences%rowtype;
  v_id bigint;
  v_added integer;
begin
  if not has_resource_access('/attendance/planned-absences') then
    raise exception 'You do not have access to planned absences.';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day must be on or after the first day.'
      using errcode = 'check_violation';
  end if;
  if p_end - p_start > 366 then
    raise exception 'A planned absence can be at most a year long.'
      using errcode = 'check_violation';
  end if;
  if (p_start_period is not null and not exists (select 1 from periods where period_number = p_start_period))
     or (p_end_period is not null and not exists (select 1 from periods where period_number = p_end_period)) then
    raise exception 'Choose a lesson from the list.'
      using errcode = 'check_violation';
  end if;
  if p_start = p_end and p_start_period is not null and p_end_period is not null and p_end_period < p_start_period then
    raise exception 'The last lesson must be the same as or after the first lesson.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from students s where s.student_id = p_student_id and s.status = 'active') then
    raise exception 'That student is not on roll.'
      using errcode = 'check_violation';
  end if;
  select ac.status into v_status from attendance_codes ac where ac.code = p_code;
  if v_status is distinct from 'authorized_absence' then
    raise exception 'Choose an authorised absence code (illness, appointment, holiday, visit, exclusion...).'
      using errcode = 'check_violation';
  end if;

  -- Overlap counts lessons on a shared day: Periods 1-3 and 4-6 on the same
  -- day can both exist.
  select * into v_clash from planned_absences pa
   where pa.student_id = p_student_id and pa.cancelled_at is null
     and (pa.start_date, coalesce(pa.start_period, 0)) <= (p_end, coalesce(p_end_period, 99))
     and (pa.end_date, coalesce(pa.end_period, 99)) >= (p_start, coalesce(p_start_period, 0))
   limit 1;
  if found then
    raise exception 'This student already has a planned absence from % to %. End or cancel it first.',
      to_char(v_clash.start_date, 'Dy DD Mon YYYY'), to_char(v_clash.end_date, 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  insert into planned_absences (student_id, start_date, end_date, start_period, end_period, code, notes, created_by_staff_id)
  values (p_student_id, p_start, p_end, p_start_period, p_end_period, p_code, nullif(btrim(p_notes), ''),
          (select p.staff_id from profiles p where p.id = auth.uid()))
  returning id into v_id;

  v_added := planned_absence_apply_days(v_id, p_start, p_end);
  return json_build_object('id', v_id, 'marks_added', v_added);
end;
$$;

revoke execute on function public.plan_absence(integer, date, date, text, text, integer, integer) from public, anon;
grant execute on function public.plan_absence(integer, date, date, text, text, integer, integer) to authenticated;

-- p_back_on / p_back_period: the first day and lesson the student is back
-- (no lesson = the start of the day). At or before the start of the absence,
-- the whole absence is cancelled.
create or replace function public.end_planned_absence_from(p_id bigint, p_back_on date, p_back_period integer default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r planned_absences%rowtype;
  v_removed integer;
  v_first_period integer := (select min(period_number) from periods);
begin
  if not has_resource_access('/attendance/planned-absences') then
    raise exception 'You do not have access to planned absences.';
  end if;
  select * into r from planned_absences where id = p_id for update;
  if not found or r.cancelled_at is not null then
    raise exception 'That planned absence no longer exists or was already cancelled.';
  end if;
  if p_back_on is null then
    raise exception 'Choose the day the student is back.';
  end if;
  if p_back_period is not null and not exists (select 1 from periods where period_number = p_back_period) then
    raise exception 'Choose a lesson from the list.'
      using errcode = 'check_violation';
  end if;
  if p_back_period = v_first_period then
    p_back_period := null;
  end if;
  if (p_back_on, coalesce(p_back_period, 0)) > (r.end_date, coalesce(r.end_period, 99)) then
    raise exception 'That planned absence already ends before then.'
      using errcode = 'check_violation';
  end if;

  delete from attendance a
   where a.planned_absence_id = p_id
     and (a.attend_date > p_back_on
          or (a.attend_date = p_back_on and a.period_number >= coalesce(p_back_period, 0)));
  get diagnostics v_removed = row_count;

  if (p_back_on, coalesce(p_back_period, 0)) <= (r.start_date, coalesce(r.start_period, 0)) then
    update planned_absences set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
    return json_build_object('cancelled', true, 'marks_removed', v_removed);
  end if;

  if p_back_period is null then
    update planned_absences set end_date = p_back_on - 1, end_period = null where id = p_id;
  else
    update planned_absences set end_date = p_back_on, end_period = p_back_period - 1 where id = p_id;
  end if;
  return json_build_object('cancelled', false, 'marks_removed', v_removed);
end;
$$;

revoke execute on function public.end_planned_absence_from(bigint, date, integer) from public, anon;
grant execute on function public.end_planned_absence_from(bigint, date, integer) to authenticated;

-- The office only. Every mark the absence still holds changes with it; marks
-- the office has since changed on a register are no longer linked and stay.
create or replace function public.change_planned_absence_code(p_id bigint, p_code text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r planned_absences%rowtype;
  v_status text;
  v_changed integer;
begin
  if not is_attendance_office() then
    raise exception 'Only the school office or the attendance officer can change a planned absence''s code.';
  end if;
  select * into r from planned_absences where id = p_id for update;
  if not found or r.cancelled_at is not null then
    raise exception 'That planned absence no longer exists or was already cancelled.';
  end if;
  select ac.status into v_status from attendance_codes ac where ac.code = p_code;
  if v_status is distinct from 'authorized_absence' then
    raise exception 'Choose an authorised absence code (illness, appointment, holiday, visit, exclusion...).'
      using errcode = 'check_violation';
  end if;
  if p_code = r.code then
    return json_build_object('marks_changed', 0);
  end if;

  update planned_absences set code = p_code where id = p_id;
  update attendance set code = p_code, status = v_status where planned_absence_id = p_id;
  get diagnostics v_changed = row_count;
  return json_build_object('marks_changed', v_changed);
end;
$$;

revoke execute on function public.change_planned_absence_code(bigint, text) from public, anon;
grant execute on function public.change_planned_absence_code(bigint, text) to authenticated;

-- One way in: the 318 functions stay for history but the app can't call them.
revoke execute on function public.add_planned_absence(integer, date, date, text, text) from authenticated;
revoke execute on function public.end_planned_absence(bigint, date) from authenticated;

-- 5. Planned-absence marks are the office's -------------------------------------------------
-- The functions above are SECURITY DEFINER (current_user is their owner) and
-- pass straight through. From the app: a new mark never carries the link; a
-- linked mark can be changed or deleted only by the office, and the office's
-- change unlinks it; anyone else's save of it unchanged keeps it as it is.
create or replace function public.attendance_planned_link_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.planned_absence_id is not null and not is_attendance_office() then
      raise exception 'This mark (%) comes from a planned absence. Only the school office or the attendance officer can change it.', old.code
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.planned_absence_id is not null and not is_attendance_office() then
    if (new.student_id, new.attend_date, new.period_number, new.code, new.status, coalesce(new.minutes_late, -1))
       is distinct from (old.student_id, old.attend_date, old.period_number, old.code, old.status, coalesce(old.minutes_late, -1)) then
      raise exception 'This mark (%) comes from a planned absence. Only the school office or the attendance officer can change it.', old.code
        using errcode = 'insufficient_privilege';
    end if;
    new.planned_absence_id := old.planned_absence_id;
    new.other_half_activity_id := old.other_half_activity_id;
    new.staff_id := old.staff_id;
    return new;
  end if;

  new.planned_absence_id := null;
  return new;
end;
$$;

create or replace trigger trg_attendance_planned_link
  before insert or update or delete on public.attendance
  for each row execute function public.attendance_planned_link_guard();

-- 6. A register is taken once everyone in it has a mark -------------------------------------
-- As live (migration 375), with the "has students" checks narrowed to "has an
-- active student with no mark yet in this period today".
create or replace view public.registers_not_done with (security_invoker = true) as
 select ts.slot_id,
    coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id) as staff_id,
    ((s.first_name || ' '::text) || s.last_name) ||
        case when lc.cover_id is not null then ' (cover)'::text else ''::text end as teacher_name,
    c.class_code,
    ts.period_number,
    p.period_name,
    p.short_label,
    ts.start_time,
    extract(epoch from school_now() - (school_today() + ts.start_time)) / 60::numeric as minutes_since_start,
    null::bigint as other_half_activity_id,
    array[coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id)] as staff_ids
   from timetable_slots ts
     join classes c on c.class_id = ts.class_id
     left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
       and lc.cover_date = school_today() and lc.cancelled_at is null
     join staff s on s.staff_id = coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id)
     left join periods p on p.period_number = ts.period_number
  where ts.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy'::text)
    and school_now() > (school_today() + ts.start_time + '00:15:00'::interval)
    and (exists (select 1 from terms t where school_today() >= t.start_date and school_today() <= t.end_date))
    and (exists (select 1
           from student_class sc
           join students stu on stu.student_id = sc.student_id
          where sc.class_id = ts.class_id and stu.status = 'active'::text
            and not (exists (select 1 from attendance a2
                  where a2.student_id = sc.student_id and a2.attend_date = school_today()
                    and a2.period_number = ts.period_number))))
    and not (exists (select 1
           from attendance a
             join student_class sc on sc.student_id = a.student_id
          where sc.class_id = ts.class_id and a.period_number = ts.period_number
            and a.attend_date = school_today() and a.planned_absence_id is null))
union all
 select null::integer as slot_id,
    null::integer as staff_id,
    coalesce(st.names, 'No staff assigned'::text) as teacher_name,
    'Other Half: '::text || a.activity_name as class_code,
    sd.period_number,
    sd.period_name,
    sd.short_label,
    sd.start_time,
    extract(epoch from school_now() - (school_today() + sd.start_time)) / 60::numeric as minutes_since_start,
    a.activity_id as other_half_activity_id,
    coalesce(st.ids, '{}'::integer[]) as staff_ids
   from other_half_activities a
     join terms t on t.term_id = a.term_id
     join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'::text
     left join lateral (select array_agg(s.staff_id order by s.last_name) as ids,
            string_agg((s.first_name || ' '::text) || s.last_name, ', '::text order by s.last_name) as names
           from other_half_activity_staff x
             join staff s on s.staff_id = x.staff_id
          where x.activity_id = a.activity_id) st on true
  where a.is_active and a.day_of_week = to_char(school_today()::timestamp with time zone, 'Dy'::text)
    and school_today() >= t.start_date and school_today() <= t.end_date
    and school_now() > (school_today() + sd.start_time + '00:15:00'::interval)
    and (exists (select 1
           from other_half_choices c
             join students stu on stu.student_id = c.student_id
          where c.activity_id = a.activity_id and stu.status = 'active'::text
            and not (exists (select 1 from attendance m2
                  where m2.student_id = c.student_id and m2.attend_date = school_today()
                    and m2.period_number = sd.period_number))))
    and not (exists (select 1
           from attendance m
          where m.other_half_activity_id = a.activity_id and m.attend_date = school_today()
            and m.planned_absence_id is null));

-- As live (migration 375), with the same change.
create or replace function public.my_register_reminders()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id integer;
  v_today date := school_today();
  v_now timestamp := school_now();
  v_dy text := to_char(school_today(), 'Dy');
begin
  select p.staff_id into v_staff_id from profiles p where p.id = auth.uid();
  if v_staff_id is null then
    return null;
  end if;
  if not exists (select 1 from terms t where v_today between t.start_date and t.end_date)
     or exists (select 1 from calendar_events ce where ce.category = 'holiday' and ce.event_date = v_today) then
    return '[]'::json;
  end if;

  return coalesce((
    select json_agg(row_to_json(x) order by x.start_time, x.lesson)
      from (
        select ts.slot_id, ts.class_id, null::bigint as other_half_activity_id,
               ts.period_number, coalesce(p.period_name, 'Period ' || ts.period_number) as period_name,
               ts.start_time, ts.end_time,
               c.class_code || case when lc.cover_id is not null then ' (cover)' else '' end as lesson,
               nullif(coalesce(ts.room, c.room), '') as room,
               (extract(epoch from (v_now - (v_today + ts.start_time))) / 60)::integer as minutes_since_start
          from timetable_slots ts
          join classes c on c.class_id = ts.class_id
          left join lesson_covers lc on lc.class_id = ts.class_id and lc.period_number = ts.period_number
            and lc.cover_date = v_today and lc.cancelled_at is null
          left join periods p on p.period_number = ts.period_number
         where coalesce(lc.cover_staff_id, ts.staff_id, c.staff_id) = v_staff_id
           and ts.day_of_week = v_dy
           and v_now >= v_today + ts.start_time + interval '10 minutes'
           and exists (
             select 1 from student_class sc
               join students stu on stu.student_id = sc.student_id
              where sc.class_id = ts.class_id and stu.status = 'active'
                and not exists (select 1 from attendance a2
                                 where a2.student_id = sc.student_id and a2.attend_date = v_today
                                   and a2.period_number = ts.period_number))
           and not exists (
             select 1 from attendance a
               join student_class sc on sc.student_id = a.student_id
              where sc.class_id = ts.class_id and a.period_number = ts.period_number
                and a.attend_date = v_today and a.planned_absence_id is null)
        union all
        select null, null, a.activity_id,
               sd.period_number, sd.period_name,
               sd.start_time, sd.end_time,
               'Other Half: ' || a.activity_name,
               nullif(a.room, ''),
               (extract(epoch from (v_now - (v_today + sd.start_time))) / 60)::integer
          from other_half_activity_staff x
          join other_half_activities a on a.activity_id = x.activity_id
          join terms t on t.term_id = a.term_id
          join school_day sd on sd.day_of_week = a.day_of_week and sd.short_label = 'OH'
         where x.staff_id = v_staff_id
           and a.is_active
           and a.day_of_week = v_dy
           and v_today between t.start_date and t.end_date
           and v_now >= v_today + sd.start_time + interval '10 minutes'
           and exists (
             select 1 from other_half_choices ch
               join students s on s.student_id = ch.student_id
              where ch.activity_id = a.activity_id and s.status = 'active'
                and not exists (select 1 from attendance m2
                                 where m2.student_id = ch.student_id and m2.attend_date = v_today
                                   and m2.period_number = sd.period_number))
           and not exists (
             select 1 from attendance m
              where m.other_half_activity_id = a.activity_id and m.attend_date = v_today
                and m.planned_absence_id is null)
      ) x
  ), '[]'::json);
end;
$$;
