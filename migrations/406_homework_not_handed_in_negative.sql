-- Migration 406: homework released as Not handed in records a negative.
--
-- Why (the principal, 8 Oct 2026): "When a homework is released as not done
-- on the mark book, the negative event needs to be recorded automatically."
-- Until now a teacher had to log "Homework not completed" by hand as well as
-- marking the homework Not handed in, so most weren't logged.
--
-- The rule:
--   * when: the moment a student's Not handed in reaches them, i.e. when the
--     teacher releases the homework's marks (homework.marks_released goes
--     from false to true), or when a mark on an already-released homework is
--     entered or changed to Not handed in. Unreleased marks record nothing:
--     the teacher may still be chasing it.
--   * what: one event per student and homework, in the existing negative
--     category "Homework not completed" with that category's points (-2 when
--     written; points are fixed at logging, 378). Dated the day of release,
--     on the homework's class, with a description naming the homework, class
--     and due date. Excused never counts. Only active students.
--   * who: the event is logged as the teacher who released or marked it
--     (set_behaviour_event_logged_by() stamps staff_id from auth.uid(), as for
--     any event they log), so they can edit it and it counts as theirs.
--   * the usual rules follow from the category: it isn't a serious event, so
--     no detention of its own, but it counts towards the weekly total
--     detention and alert; it has writing, so it waits under "Writing to
--     approve" on /behaviour/review before parents see it (387).
--
-- Correcting it withdraws it: if the mark is changed from Not handed in
-- (to a mark, a grade or Excused) or deleted, or the homework's marks are
-- un-released or the homework is withdrawn, the event is withdrawn (points
-- to 0, voided_points kept) and, if not yet held, the week's total detention
-- it tipped is cancelled, the same way as 388. Marking Not handed in again
-- afterwards records a fresh event.
--
-- homework_negatives keeps which (homework, student) produced which event, so
-- an event SMT delete or the review returns is never made again while its
-- mark stands. RLS on, no policies, no grants: written only by these
-- functions. Its backup-mode guard is attached by guard_new_tables.
--
-- Homework released before this migration isn't back-filled.

set local formwork.change_note = 'Principal (direct)';

create table public.homework_negatives (
  id bigint generated always as identity primary key,
  homework_id bigint not null,
  student_id integer not null references public.students (student_id),
  event_id integer references public.behaviour_events (event_id) on delete set null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
-- A unique index, not a constraint, so PostgREST never reads the table as a
-- junction (see 306). Only one live link per homework and student.
create unique index homework_negatives_live
  on public.homework_negatives (homework_id, student_id) where withdrawn_at is null;
create index homework_negatives_event on public.homework_negatives (event_id);

alter table public.homework_negatives enable row level security;
revoke all on public.homework_negatives from anon, authenticated;

-- Records the event for one student's Not handed in, unless one stands.
-- Internal (called from the triggers below).
create or replace function public.record_homework_negative(p_homework_id bigint, p_student_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hw homework%rowtype;
  v_category text;
  v_points integer;
  v_event_id integer;
begin
  select * into v_hw from homework where homework_id = p_homework_id;
  if v_hw.homework_id is null or v_hw.status <> 'set' or not v_hw.marks_released then
    return;
  end if;
  if not exists (select 1 from students s
                  where s.student_id = p_student_id and s.status = 'active' and not s.is_demo) then
    return;
  end if;
  if exists (select 1 from homework_negatives k
              where k.homework_id = p_homework_id and k.student_id = p_student_id
                and k.withdrawn_at is null) then
    return;
  end if;

  select name, default_points into v_category, v_points
    from behaviour_categories
   where name = 'Homework not completed' and type = 'negative' and not retired;
  if v_category is null or v_points is null then
    return;
  end if;

  insert into behaviour_events
    (student_id, event_date, event_time, type, category, points, description, class_id)
  values
    (p_student_id, school_today(), school_now()::time, 'negative', v_category, v_points,
     'Recorded automatically: homework "' || v_hw.title || '" (' || v_hw.class_code
       || ', due ' || to_char(v_hw.due_on, 'FMDy FMDD FMMon') || ') marked Not handed in.',
     v_hw.class_id)
  returning event_id into v_event_id;

  insert into homework_negatives (homework_id, student_id, event_id)
  values (p_homework_id, p_student_id, v_event_id);
end;
$$;

revoke execute on function public.record_homework_negative(bigint, integer) from public, anon, authenticated;

-- Withdraws the standing event for one student and homework, if any.
-- Internal. Same withdrawal as withdraw_missed_lesson_negative() (388).
create or replace function public.withdraw_homework_negative(p_homework_id bigint, p_student_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_link homework_negatives%rowtype;
  v_event behaviour_events%rowtype;
  v_week_start date;
  v_week_total integer;
  r behaviour_rules;
begin
  select * into v_link from homework_negatives
   where homework_id = p_homework_id and student_id = p_student_id and withdrawn_at is null;
  if v_link.id is null then
    return;
  end if;

  update homework_negatives set withdrawn_at = now() where id = v_link.id;

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
end;
$$;

revoke execute on function public.withdraw_homework_negative(bigint, integer) from public, anon, authenticated;

-- A mark entered, changed or removed.
create or replace function public.homework_mark_negative()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.grade = 'Not handed in'
     and (tg_op = 'DELETE' or new.grade is distinct from 'Not handed in'
          or new.student_id <> old.student_id or new.homework_id <> old.homework_id) then
    perform withdraw_homework_negative(old.homework_id, old.student_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.grade = 'Not handed in' then
    perform record_homework_negative(new.homework_id, new.student_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.homework_mark_negative() from public, anon, authenticated;

create trigger trg_homework_mark_negative
  after insert or update of grade, student_id, homework_id or delete on public.homework_marks
  for each row
  execute function public.homework_mark_negative();

-- Marks released, un-released, or the homework withdrawn or restored.
create or replace function public.homework_release_negatives()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_was boolean := old.marks_released and old.status = 'set';
  v_now boolean := new.marks_released and new.status = 'set';
  m record;
begin
  if v_now and not v_was then
    for m in select student_id from homework_marks
              where homework_id = new.homework_id and grade = 'Not handed in'
    loop
      perform record_homework_negative(new.homework_id, m.student_id);
    end loop;
  elsif v_was and not v_now then
    for m in select student_id from homework_negatives
              where homework_id = new.homework_id and withdrawn_at is null
    loop
      perform withdraw_homework_negative(new.homework_id, m.student_id);
    end loop;
  end if;
  return null;
end;
$$;

revoke execute on function public.homework_release_negatives() from public, anon, authenticated;

create trigger trg_homework_release_negatives
  after update of marks_released, status on public.homework
  for each row
  execute function public.homework_release_negatives();

-- Applied through the connector on 8 Oct 2026 first with integer
-- homework_id, which made releasing marks fail (homework_id is bigint); fixed
-- minutes later as 406a, giving the bigint versions above. The two unused
-- integer versions are left in the live database because the connector holds
-- back drop function; remove them in the SQL editor:
--   drop function public.record_homework_negative(integer, integer);
--   drop function public.withdraw_homework_negative(integer, integer);
