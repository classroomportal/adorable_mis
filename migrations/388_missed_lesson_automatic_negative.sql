-- Migration 388: missing a lesson or activity records a negative automatically.
--
-- Why (the principal, 7 Oct 2026): "Anyone who misses a lesson needs an
-- automatic negative recorded of missing a lesson or activity." Missed
-- Lessons (307–308) and the office pop-up (309) show who skipped, but nothing
-- went on the student's behaviour record unless a teacher logged it by hand.
--
-- The principal's choices:
--   * who: the Missed Lessons rule. A student marked absent without a reason
--     (status 'absent': codes N and O) at a lesson, an Other Half activity or
--     Evening Prep, who was marked present or late at some other period that
--     day, before or after. A student away all day is an attendance matter,
--     not this. Authorised absences (planned absences included) never count.
--     Registration (short_label 'M') is left out: absent at registration and
--     present at Period 1 is lateness to school, not a missed lesson.
--   * points: the existing negative category "Missing a lesson activity"
--     (-5), one event per missed period. At -5 it is a serious event, so it
--     gives its own detention (handle_negative_behaviour()), sends the usual
--     behaviour alert, and waits for the office/SMT review before parents see
--     it, like any Stage 5.
--   * when: at the end of the lesson. record_missed_lesson_negatives() runs
--     every 5 minutes (cron) for today, for every period whose end time has
--     passed. A student who skipped Period 1 and is marked present at Period 3
--     is recorded on the run after the Period 3 mark is saved.
--
-- The event is the school's, not a teacher's: staff_id is null (the
-- description names the lesson, the code and who marked them absent), so it
-- never raises the Stage 5 "collect from lesson" pop-up (383) or counts in a
-- teacher's returned-events tally. Points come from the category when the
-- event is made (points are fixed at logging, 378). If the category is
-- retired or renamed nothing is recorded.
--
-- One event per student, date and period, ever: missed_lesson_negatives keeps
-- which mark produced which event, so an event SMT delete or the review
-- returns is never made again by the next run.
--
-- A corrected mark withdraws it: if the absent mark is changed to present,
-- late or an authorised absence, or deleted, the event is withdrawn (points
-- to 0, voided_points kept) and its detention, and the week's total
-- detention if the total no longer reaches it, are cancelled if not yet held,
-- the same way as an upheld appeal. Changing N to O changes nothing.
--
-- Starts on 8 Oct 2026, so registers already taken today, before staff knew
-- an N or O now gives a detention, aren't counted.
--
-- missed_lesson_negatives is read and written only by these functions (RLS
-- on, no policies, no grants), like missed_lesson_alert_acks (309). Its
-- backup-mode guard is attached by guard_new_tables.

set local formwork.change_note = 'Principal (direct)';

create table public.missed_lesson_negatives (
  id bigint generated always as identity primary key,
  student_id integer not null references public.students (student_id),
  attend_date date not null,
  period_number integer not null references public.periods (period_number),
  attendance_id integer,
  event_id integer references public.behaviour_events (event_id) on delete set null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
-- A unique index, not a constraint, so PostgREST never reads the table as a
-- junction (see 306).
create unique index missed_lesson_negatives_key
  on public.missed_lesson_negatives (student_id, attend_date, period_number);
create index missed_lesson_negatives_attendance
  on public.missed_lesson_negatives (attendance_id);

alter table public.missed_lesson_negatives enable row level security;
revoke all on public.missed_lesson_negatives from anon, authenticated;

create or replace function public.record_missed_lesson_negatives()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_today date := school_today();
  v_dy text := to_char(school_today(), 'Dy');
  v_now timestamp := school_now();
  v_category text;
  v_points integer;
  v_event_id integer;
  v_count integer := 0;
  m record;
begin
  if v_today < date '2026-10-08' then
    return 0;
  end if;
  if not exists (select 1 from terms tm where v_today between tm.start_date and tm.end_date) then
    return 0;
  end if;

  select name, default_points into v_category, v_points
    from behaviour_categories
   where name = 'Missing a lesson activity' and type = 'negative' and not retired;
  if v_category is null or v_points is null then
    return 0;
  end if;

  for m in
    select a.attendance_id, a.student_id, a.period_number, sd.period_name, sd.start_time,
           ac.description as code_description,
           marker.first_name || ' ' || marker.last_name as marked_by,
           oha.activity_name,
           les.class_id, les.class_code
      from attendance a
      join school_day sd on sd.day_of_week = v_dy and sd.period_number = a.period_number
      join students s on s.student_id = a.student_id and s.status = 'active' and not s.is_demo
      left join attendance_codes ac on ac.code = a.code
      left join staff marker on marker.staff_id = a.staff_id
      left join other_half_activities oha on oha.activity_id = a.other_half_activity_id
      left join lateral (
        select c.class_id, c.class_code
          from student_class sc
          join timetable_slots ts on ts.class_id = sc.class_id
                                  and ts.day_of_week = v_dy
                                  and ts.period_number = a.period_number
          join classes c on c.class_id = sc.class_id
         where sc.student_id = a.student_id
           and a.other_half_activity_id is null
         order by c.class_code
         limit 1
      ) les on true
     where a.attend_date = v_today
       and a.status = 'absent'
       and not a.is_demo
       and coalesce(sd.short_label, '') <> 'M'
       and v_now >= v_today + sd.end_time
       and exists (
         select 1 from attendance e
          where e.student_id = a.student_id and e.attend_date = v_today
            and e.status in ('present', 'late')
       )
       and not exists (
         select 1 from missed_lesson_negatives k
          where k.student_id = a.student_id and k.attend_date = v_today
            and k.period_number = a.period_number
       )
     order by a.student_id, sd.start_time
  loop
    insert into behaviour_events
      (student_id, staff_id, event_date, event_time, type, category, points, description, class_id)
    values
      (m.student_id, null, v_today, m.start_time, 'negative', v_category, v_points,
       'Recorded automatically: marked ' || coalesce(m.code_description, 'absent')
         || ' at ' || coalesce(m.period_name, 'period ' || m.period_number)
         || coalesce(' (' || coalesce('Other Half: ' || m.activity_name, m.class_code) || ')', '')
         || coalesce(' by ' || m.marked_by, '')
         || ', having been marked present or late at another period that day.',
       m.class_id)
    returning event_id into v_event_id;

    insert into missed_lesson_negatives (student_id, attend_date, period_number, attendance_id, event_id)
    values (m.student_id, v_today, m.period_number, m.attendance_id, v_event_id)
    on conflict (student_id, attend_date, period_number) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.record_missed_lesson_negatives() from public, anon, authenticated;

-- Withdraws the event when its absent mark is corrected or deleted. Runs as
-- the teacher saving the register, so SECURITY DEFINER: the update below
-- would otherwise be refused by behaviour_event_release_guard().
create or replace function public.withdraw_missed_lesson_negative()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_link missed_lesson_negatives%rowtype;
  v_event behaviour_events%rowtype;
  v_week_start date;
  v_week_total integer;
  r behaviour_rules;
begin
  if tg_op = 'UPDATE' and new.status = 'absent' then
    return null;
  end if;

  select * into v_link from missed_lesson_negatives
   where attendance_id = old.attendance_id and withdrawn_at is null
   limit 1;
  if v_link.id is null then
    return null;
  end if;

  update missed_lesson_negatives set withdrawn_at = now() where id = v_link.id;

  update behaviour_events
     set voided_points = points, points = 0, voided_at = now()
   where event_id = v_link.event_id and voided_at is null
  returning * into v_event;

  if v_event.event_id is not null then
    select * into r from behaviour_rules where id;
    v_week_start := v_event.event_date - (((extract(dow from v_event.event_date)::int - 6 + 7) % 7));

    select coalesce(sum(points), 0) into v_week_total
      from behaviour_events
     where student_id = v_event.student_id and type = 'negative' and voided_at is null
       and event_date between v_week_start and v_week_start + 6;

    update detentions set status = 'cancelled'
     where status = 'scheduled'
       and detention_date >= school_today()
       and (behaviour_event_id = v_event.event_id
            or (v_week_total > r.detention_weekly_total_points
                and student_id = v_event.student_id
                and detention_date = v_week_start + 6
                and behaviour_event_id is null));
  end if;

  return null;
end;
$$;

revoke execute on function public.withdraw_missed_lesson_negative() from public, anon, authenticated;

create trigger trg_withdraw_missed_lesson_negative
  after update of status or delete on public.attendance
  for each row
  when (old.status = 'absent')
  execute function public.withdraw_missed_lesson_negative();

select cron.schedule(
  'record-missed-lesson-negatives',
  '*/5 * * * *',
  'select public.record_missed_lesson_negatives();'
);
