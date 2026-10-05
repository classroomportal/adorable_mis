-- Migration 374: cover for absent teachers.
--
-- Why: the principal, 5 Oct 2026: when a teacher is absent a member of SMT
-- opens that teacher's timetable and gives each lesson to a teacher who is
-- free then, chosen from a list. The cover shows on the covering teacher's
-- timetable for that date only, with an apology for the extra work.
--
--   * Only SMT arrange or cancel cover (has_staff_role, so admin alone is not
--     enough), through add_lesson_cover() / cancel_lesson_cover(). The table
--     has a select policy only.
--   * The absent teacher is worked out from the lesson (the lesson's own
--     teacher where Nova-T gives one, migration 182, else the class's), never
--     taken from the request.
--   * The covering teacher must be free: no lesson of their own, no Nova-T
--     commitment and no Other Half activity then, and not already covering
--     another lesson then. free_cover_staff() lists who is free, with how many
--     covers each has done this term so the load can be shared out, and flags
--     anyone being covered for at another period that day (likely absent, but
--     maybe out for one lesson only, so it is a warning, not a block).
--   * Covers are cancelled, never deleted; who arranged and who cancelled are
--     stamped from auth.uid(). One live cover per lesson.
--   * The covering teacher gets an inbox notice with the apology, and another
--     if it is cancelled.
--   * A cover is for one date. The class's lesson, register and teacher are
--     unchanged; any member of staff can already mark any register (migration
--     330), so the covering teacher takes it from their timetable.
--
-- Like lesson_feedback (365), the link to the lesson (slot_id) goes empty when
-- the Nova-T import re-creates lessons; class, date and period still identify
-- it.

set local formwork.change_note = 'Principal (direct)';

create table public.lesson_covers (
  cover_id bigserial primary key,
  cover_date date not null,
  period_number integer not null references public.periods(period_number),
  class_id integer not null references public.classes(class_id),
  slot_id integer references public.timetable_slots(slot_id) on delete set null,
  absent_staff_id integer not null references public.staff(staff_id),
  cover_staff_id integer not null references public.staff(staff_id),
  note text check (note is null or length(note) <= 300),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  check (cover_staff_id <> absent_staff_id)
);

create unique index lesson_covers_one_per_lesson
  on public.lesson_covers (class_id, cover_date, period_number) where cancelled_at is null;
create index lesson_covers_cover_staff on public.lesson_covers (cover_staff_id, cover_date);
create index lesson_covers_absent_staff on public.lesson_covers (absent_staff_id, cover_date);

alter table public.lesson_covers enable row level security;
grant select on public.lesson_covers to authenticated;

-- All staff can see covers, like the timetable itself.
create policy lesson_covers_staff_read on public.lesson_covers
  for select to authenticated using ((select is_staff_or_admin()));

-- ---- Who may arrange cover ----------------------------------------------------

create or replace function public.can_arrange_cover()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select has_staff_role(array['smt']);
$$;

revoke execute on function public.can_arrange_cover() from public, anon;
grant execute on function public.can_arrange_cover() to authenticated;

-- ---- Is a member of staff busy at a date and period? --------------------------

-- Returns what they are doing then (a class code, a commitment, an Other Half
-- activity or a cover), or null when free.
create or replace function public.staff_busy_at(p_staff_id integer, p_date date, p_period integer)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with d as (select to_char(p_date, 'Dy') as dow)
  select coalesce(
    -- their own lessons: their classes' lessons not given to someone else,
    -- plus single lessons of other classes given to them
    (select c.class_code from timetable_slots ts join classes c on c.class_id = ts.class_id, d
      where ts.day_of_week = d.dow and ts.period_number = p_period
        and coalesce(ts.staff_id, c.staff_id) = p_staff_id
      limit 1),
    (select btrim(sc.label) from staff_commitments sc, d
      where sc.staff_id = p_staff_id and sc.day_of_week = d.dow and sc.period_number = p_period
      limit 1),
    (select 'OH: ' || a.activity_name
       from other_half_activity_staff s
       join other_half_activities a on a.activity_id = s.activity_id
       join terms t on t.term_id = a.term_id and p_date between t.start_date and t.end_date
       join periods p on p.short_label = 'OH' and p.period_number = p_period, d
      where s.staff_id = p_staff_id and a.is_active and a.day_of_week = d.dow
      limit 1),
    (select 'Covering ' || c.class_code from lesson_covers lc join classes c on c.class_id = lc.class_id
      where lc.cover_staff_id = p_staff_id and lc.cover_date = p_date
        and lc.period_number = p_period and lc.cancelled_at is null
      limit 1)
  );
$$;

revoke execute on function public.staff_busy_at(integer, date, integer) from public, anon, authenticated;

-- ---- Who is free to cover a lesson ---------------------------------------------

-- Staff free at that date and period, excluding the lesson's own teacher.
-- teaches = has any lesson on the timetable (the page hides the rest unless
-- asked: office staff and people who have left are in the staff table too).
-- covers_this_term = live covers in the term containing the date.
-- covered_today = someone is covering one of their lessons that day.
create or replace function public.free_cover_staff(p_class_id integer, p_date date, p_period integer)
returns table (staff_id integer, first_name text, last_name text, teaches boolean, covers_this_term integer,
               covered_today boolean)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_absent integer;
  v_start date;
  v_end date;
begin
  if not can_arrange_cover() then
    raise exception 'Only SMT can arrange cover.';
  end if;

  select coalesce(ts.staff_id, c.staff_id) into v_absent
  from timetable_slots ts join classes c on c.class_id = ts.class_id
  where ts.class_id = p_class_id and ts.day_of_week = to_char(p_date, 'Dy') and ts.period_number = p_period
  limit 1;

  select t.start_date, t.end_date into v_start, v_end
  from terms t where p_date between t.start_date and t.end_date
  limit 1;

  return query
  select s.staff_id, s.first_name, s.last_name,
         exists (select 1 from classes c where c.staff_id = s.staff_id)
           or exists (select 1 from timetable_slots ts where ts.staff_id = s.staff_id),
         (select count(*)::integer from lesson_covers lc
           where lc.cover_staff_id = s.staff_id and lc.cancelled_at is null
             and lc.cover_date between coalesce(v_start, p_date) and coalesce(v_end, p_date)),
         exists (select 1 from lesson_covers lc
           where lc.absent_staff_id = s.staff_id and lc.cover_date = p_date and lc.cancelled_at is null)
  from staff s
  where s.staff_id is distinct from v_absent
    and staff_busy_at(s.staff_id, p_date, p_period) is null
  order by s.last_name, s.first_name;
end;
$$;

revoke execute on function public.free_cover_staff(integer, date, integer) from public, anon;
grant execute on function public.free_cover_staff(integer, date, integer) to authenticated;

-- ---- Arrange cover --------------------------------------------------------------

create or replace function public.add_lesson_cover(
  p_class_id integer, p_date date, p_period integer, p_cover_staff_id integer, p_note text default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_slot integer;
  v_absent integer;
  v_class_code text;
  v_busy text;
  v_existing text;
  v_id bigint;
  v_absent_name text;
  v_period_name text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not can_arrange_cover() then
    raise exception 'Only SMT can arrange cover.';
  end if;
  if p_date < school_today() then
    raise exception 'Cover can only be arranged for today or a later date.';
  end if;

  select ts.slot_id, coalesce(ts.staff_id, c.staff_id), c.class_code
    into v_slot, v_absent, v_class_code
  from timetable_slots ts join classes c on c.class_id = ts.class_id
  where ts.class_id = p_class_id and ts.day_of_week = to_char(p_date, 'Dy') and ts.period_number = p_period
  limit 1;
  if v_slot is null then
    raise exception 'That class has no lesson at that period on %.', to_char(p_date, 'FMDay FMDD FMMonth');
  end if;
  if v_absent is null then
    raise exception 'That lesson has no teacher on the timetable.';
  end if;
  if p_cover_staff_id = v_absent then
    raise exception 'A teacher can''t cover their own lesson.';
  end if;

  select s.first_name || ' ' || s.last_name into v_existing
  from lesson_covers lc join staff s on s.staff_id = lc.cover_staff_id
  where lc.class_id = p_class_id and lc.cover_date = p_date and lc.period_number = p_period
    and lc.cancelled_at is null;
  if v_existing is not null then
    raise exception 'This lesson is already covered by %. Cancel that cover first.', v_existing;
  end if;

  v_busy := staff_busy_at(p_cover_staff_id, p_date, p_period);
  if v_busy is not null then
    raise exception 'That teacher isn''t free then (%).', v_busy;
  end if;

  insert into lesson_covers (cover_date, period_number, class_id, slot_id, absent_staff_id,
                             cover_staff_id, note, created_by)
  values (p_date, p_period, p_class_id, v_slot, v_absent, p_cover_staff_id, v_note, auth.uid())
  returning cover_id into v_id;

  select first_name || ' ' || last_name into v_absent_name from staff where staff_id = v_absent;
  select period_name into v_period_name from periods where period_number = p_period;

  perform post_inbox_notice(
    array(select id from profiles where staff_id = p_cover_staff_id),
    'Cover: ' || v_class_code || ', ' || to_char(p_date, 'FMDay FMDD FMMonth') || ', ' || v_period_name,
    '<p>Please cover <strong>' || html_escape(v_class_code) || '</strong> (' || html_escape(v_period_name)
      || ') on ' || to_char(p_date, 'FMDay FMDD FMMonth') || ' for ' || html_escape(v_absent_name) || '.</p>'
      || coalesce('<p>' || html_escape(v_note) || '</p>', '')
      || '<p>Sorry for the extra work, and thank you for helping. The lesson is on your timetable for that day, '
      || 'and you can take the register from there.</p>',
    'cover');
  return v_id;
end;
$$;

revoke execute on function public.add_lesson_cover(integer, date, integer, integer, text) from public, anon;
grant execute on function public.add_lesson_cover(integer, date, integer, integer, text) to authenticated;

-- ---- Cancel cover ---------------------------------------------------------------

create or replace function public.cancel_lesson_cover(p_cover_id bigint)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  lc lesson_covers%rowtype;
  v_class_code text;
  v_period_name text;
begin
  if not can_arrange_cover() then
    raise exception 'Only SMT can cancel cover.';
  end if;
  select * into lc from lesson_covers where cover_id = p_cover_id for update;
  if not found or lc.cancelled_at is not null then
    raise exception 'That cover isn''t in place.';
  end if;
  if lc.cover_date < school_today() then
    raise exception 'A past cover can''t be cancelled; it stays on the record.';
  end if;

  update lesson_covers set cancelled_at = now(), cancelled_by = auth.uid() where cover_id = p_cover_id;

  select class_code into v_class_code from classes where class_id = lc.class_id;
  select period_name into v_period_name from periods where period_number = lc.period_number;
  perform post_inbox_notice(
    array(select id from profiles where staff_id = lc.cover_staff_id),
    'Cover cancelled: ' || v_class_code || ', ' || to_char(lc.cover_date, 'FMDay FMDD FMMonth'),
    '<p>You no longer need to cover <strong>' || html_escape(v_class_code) || '</strong> ('
      || html_escape(v_period_name) || ') on ' || to_char(lc.cover_date, 'FMDay FMDD FMMonth')
      || '. Thank you for being willing to help.</p>',
    'cover');
end;
$$;

revoke execute on function public.cancel_lesson_cover(bigint) from public, anon;
grant execute on function public.cancel_lesson_cover(bigint) to authenticated;
