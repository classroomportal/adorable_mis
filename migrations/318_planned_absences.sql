-- Migration 318: planned absences, one attendance code over a period of days.
--
-- Why (the principal, 2 Oct 2026): "How can the office and attendance officer
-- mark a student with an attendance code over a period of time". Until now a
-- code went in one register at a time: a three-day illness or a five-day
-- exclusion meant opening about seven registers a day and marking the one
-- student in each, and nothing could be entered in advance, because the
-- database refuses a mark for a future date (migration 146).
--
-- The principal's decisions: a planned absence never overwrites a mark that
-- is already there, and the codes offered include a new one for a student
-- excluded from school.
--
-- Now:
--   1. A new code, X "Excluded from school". Counted as an authorised absence
--      (the school has decided the student is not in), so it never shows in
--      Missed Lessons or the office pop-up, which look for unauthorised codes.
--   2. planned_absences: a student, a first and last day (whole days), one of
--      the authorised codes (C, E, H, I, M, X) and an optional note. The note
--      stays staff-only: it is never copied onto the register marks, which
--      parents can read.
--   3. Marks are written for every period the student actually has that day:
--      each timetabled lesson of their classes (registration and Evening Prep
--      included, a class they joined later only from the day they joined) and
--      their Other Half activity, tagged with it as the OH register expects.
--      Days outside term dates and days with a 'holiday' calendar event are
--      skipped. A period that already has a mark is left alone.
--      Past days and today are written as soon as the absence is added; later
--      days are written each morning at 05:30 Lagos time by the cron job
--      'apply-planned-absences' (it also catches up the last 7 days, in case a
--      run was missed). The future-date rule stays as it is.
--   4. Each mark carries attendance.planned_absence_id. Registers show the
--      code already filled in, so the teacher doesn't mark the student absent
--      without a reason. Once a teacher saves that register (keeping the code,
--      or changing it because the student turned up after all) the mark is
--      the teacher's: it is unlinked from the absence, ending or cancelling
--      the absence later leaves it alone, and it counts as the register being
--      taken. The app can't set or move the link itself.
--   5. Registers Not Done ignores marks made by a planned absence: one absent
--      student's mark must not make a whole class's register look taken.
--   6. Adding, ending early and cancelling go only through
--      add_planned_absence() and end_planned_absence(), which check the caller
--      has the new page (/attendance/planned-absences: school office,
--      attendance officer, pastoral, SMT, and admin always). One student can't
--      have two planned absences over the same days. Ending early ("back on")
--      removes the marks it made from that day on; cancelling removes all of
--      them. All staff can read the list, as they can read registers.
--   7. Planned absences are logged in change_history under 'registers', and
--      the marks they remove are logged there as deletions already.

set local formwork.change_note = 'Principal (direct)';

-- 1. The exclusion code ---------------------------------------------------------------------
insert into public.attendance_codes (code, description, status)
values ('X', 'Excluded from school', 'authorized_absence')
on conflict (code) do nothing;

-- 2. The table ------------------------------------------------------------------------------
create table public.planned_absences (
  id bigint generated always as identity primary key,
  student_id integer not null references public.students(student_id),
  start_date date not null,
  end_date date not null,
  code text not null references public.attendance_codes(code),
  notes text,
  created_by uuid default auth.uid(),
  created_by_staff_id integer references public.staff(staff_id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid,
  check (end_date >= start_date)
);

create index planned_absences_student_idx on public.planned_absences (student_id);
create index planned_absences_dates_idx on public.planned_absences (start_date, end_date) where cancelled_at is null;

alter table public.planned_absences enable row level security;
-- Written only through the functions below, so the app gets select alone.
grant select on public.planned_absences to authenticated;

create policy staff_read_planned_absences on public.planned_absences
  for select using (is_staff_or_admin());

create trigger stamp_created_by
  before insert on public.planned_absences
  for each row execute function public.stamp_actor('created_by');

create trigger trg_log_change
  after insert or update or delete on public.planned_absences
  for each row execute function public.log_change('registers', 'id');

-- 3. The link on each mark ------------------------------------------------------------------
alter table public.attendance
  add column planned_absence_id bigint references public.planned_absences(id) on delete set null;

create index attendance_planned_absence_idx on public.attendance (planned_absence_id)
  where planned_absence_id is not null;

-- From the app the link can't be set, and any save of the mark (a teacher
-- saving the register, whether or not they change the code) breaks it: the
-- mark is then the teacher's, not the absence's. The functions below are
-- SECURITY DEFINER (current_user is their owner) and set it freely.
create or replace function public.attendance_planned_link_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  new.planned_absence_id := null;
  return new;
end;
$$;

create trigger trg_attendance_planned_link
  before insert or update on public.attendance
  for each row execute function public.attendance_planned_link_guard();

-- 4. Writing the marks ----------------------------------------------------------------------
-- Cron and the functions below only.
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
    on conflict (student_id, attend_date, period_number) do nothing;

    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;

  return v_added;
end;
$$;

revoke execute on function public.planned_absence_apply_days(bigint, date, date) from public, anon, authenticated;

create or replace function public.apply_planned_absences()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := school_today();
  v_id bigint;
  v_added integer := 0;
begin
  for v_id in
    select pa.id from planned_absences pa
     where pa.cancelled_at is null
       and pa.start_date <= v_today
       and pa.end_date >= v_today - 7
  loop
    v_added := v_added + planned_absence_apply_days(v_id, v_today - 7, v_today);
  end loop;
  return v_added;
end;
$$;

revoke execute on function public.apply_planned_absences() from public, anon, authenticated;

-- 5. Adding, ending early and cancelling ----------------------------------------------------
create or replace function public.add_planned_absence(
  p_student_id integer,
  p_start date,
  p_end date,
  p_code text,
  p_notes text default null
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
  if not exists (select 1 from students s where s.student_id = p_student_id and s.status = 'active') then
    raise exception 'That student is not on roll.'
      using errcode = 'check_violation';
  end if;
  select ac.status into v_status from attendance_codes ac where ac.code = p_code;
  if v_status is distinct from 'authorized_absence' then
    raise exception 'Choose an authorised absence code (illness, appointment, holiday, visit, exclusion...).'
      using errcode = 'check_violation';
  end if;

  select * into v_clash from planned_absences pa
   where pa.student_id = p_student_id and pa.cancelled_at is null
     and pa.start_date <= p_end and pa.end_date >= p_start
   limit 1;
  if found then
    raise exception 'This student already has a planned absence from % to %. End or cancel it first.',
      to_char(v_clash.start_date, 'Dy DD Mon YYYY'), to_char(v_clash.end_date, 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  insert into planned_absences (student_id, start_date, end_date, code, notes, created_by_staff_id)
  values (p_student_id, p_start, p_end, p_code, nullif(btrim(p_notes), ''),
          (select p.staff_id from profiles p where p.id = auth.uid()))
  returning id into v_id;

  v_added := planned_absence_apply_days(v_id, p_start, p_end);
  return json_build_object('id', v_id, 'marks_added', v_added);
end;
$$;

revoke execute on function public.add_planned_absence(integer, date, date, text, text) from public, anon;
grant execute on function public.add_planned_absence(integer, date, date, text, text) to authenticated;

-- p_back_on: the first day the student is back. On or before the first day
-- of the absence, the whole absence is cancelled.
create or replace function public.end_planned_absence(p_id bigint, p_back_on date)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r planned_absences%rowtype;
  v_removed integer;
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
  if p_back_on > r.end_date then
    raise exception 'That planned absence already ends on %.', to_char(r.end_date, 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  delete from attendance a where a.planned_absence_id = p_id and a.attend_date >= p_back_on;
  get diagnostics v_removed = row_count;

  if p_back_on <= r.start_date then
    update planned_absences set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
    return json_build_object('cancelled', true, 'marks_removed', v_removed);
  end if;

  update planned_absences set end_date = p_back_on - 1 where id = p_id;
  return json_build_object('cancelled', false, 'end_date', p_back_on - 1, 'marks_removed', v_removed);
end;
$$;

revoke execute on function public.end_planned_absence(bigint, date) from public, anon;
grant execute on function public.end_planned_absence(bigint, date) to authenticated;

-- 6. Registers Not Done ignores planned-absence marks ---------------------------------------
-- As live (migration 124 and 157), with "and a.planned_absence_id is null" /
-- "and m.planned_absence_id is null" added to the two "already taken" checks.
create or replace view public.registers_not_done with (security_invoker = true) as
 select ts.slot_id,
    coalesce(ts.staff_id, c.staff_id) as staff_id,
    ((s.first_name || ' '::text) || s.last_name) as teacher_name,
    c.class_code,
    ts.period_number,
    p.period_name,
    p.short_label,
    ts.start_time,
    (extract(epoch from (school_now() - (school_today() + ts.start_time))) / (60)::numeric) as minutes_since_start,
    null::bigint as other_half_activity_id,
    array[coalesce(ts.staff_id, c.staff_id)] as staff_ids
   from (((timetable_slots ts
     join classes c on ((c.class_id = ts.class_id)))
     join staff s on ((s.staff_id = coalesce(ts.staff_id, c.staff_id))))
     left join periods p on ((p.period_number = ts.period_number)))
  where ((ts.day_of_week = to_char((school_today())::timestamp with time zone, 'Dy'::text))
    and (school_now() > ((school_today() + ts.start_time) + '00:15:00'::interval))
    and (exists ( select 1 from terms t
          where ((school_today() >= t.start_date) and (school_today() <= t.end_date))))
    and (exists ( select 1 from student_class sc where (sc.class_id = ts.class_id)))
    and (not (exists ( select 1
           from (attendance a
             join student_class sc on ((sc.student_id = a.student_id)))
          where ((sc.class_id = ts.class_id) and (a.period_number = ts.period_number)
            and (a.attend_date = school_today()) and (a.planned_absence_id is null))))))
union all
 select null::integer as slot_id,
    null::integer as staff_id,
    coalesce(st.names, 'No staff assigned'::text) as teacher_name,
    ('Other Half: '::text || a.activity_name) as class_code,
    sd.period_number,
    sd.period_name,
    sd.short_label,
    sd.start_time,
    (extract(epoch from (school_now() - (school_today() + sd.start_time))) / (60)::numeric) as minutes_since_start,
    a.activity_id as other_half_activity_id,
    coalesce(st.ids, '{}'::integer[]) as staff_ids
   from (((other_half_activities a
     join terms t on ((t.term_id = a.term_id)))
     join school_day sd on (((sd.day_of_week = a.day_of_week) and (sd.short_label = 'OH'::text))))
     left join lateral ( select array_agg(s.staff_id order by s.last_name) as ids,
            string_agg(((s.first_name || ' '::text) || s.last_name), ', '::text order by s.last_name) as names
           from (other_half_activity_staff x
             join staff s on ((s.staff_id = x.staff_id)))
          where (x.activity_id = a.activity_id)) st on (true))
  where (a.is_active and (a.day_of_week = to_char((school_today())::timestamp with time zone, 'Dy'::text))
    and ((school_today() >= t.start_date) and (school_today() <= t.end_date))
    and (school_now() > ((school_today() + sd.start_time) + '00:15:00'::interval))
    and (exists ( select 1
           from (other_half_choices c
             join students stu on ((stu.student_id = c.student_id)))
          where ((c.activity_id = a.activity_id) and (stu.status = 'active'::text))))
    and (not (exists ( select 1 from attendance m
          where ((m.other_half_activity_id = a.activity_id) and (m.attend_date = school_today())
            and (m.planned_absence_id is null))))));

-- 7. The page and who has it ----------------------------------------------------------------
insert into public.resources (resource_key, label, section, sort_order)
values ('/attendance/planned-absences', 'Planned Absences', 'Pastoral', 25)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('school_office', '/attendance/planned-absences'),
  ('attendance_officer', '/attendance/planned-absences'),
  ('pastoral', '/attendance/planned-absences'),
  ('smt', '/attendance/planned-absences')
on conflict do nothing;

-- 8. Each morning, write today's marks ------------------------------------------------------
-- 04:30 UTC is 05:30 in Lagos, before registration.
select cron.schedule('apply-planned-absences', '30 4 * * *', 'select public.apply_planned_absences();');
