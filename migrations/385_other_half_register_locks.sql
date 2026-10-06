-- Two problems with Other Half registers, found 6 Oct 2026 (the principal).
--
-- 1. A lesson and an OH activity in the same period wrote to the same mark.
--    attendance has one row per (student, date, period), and the OH register
--    pre-filled a lesson teacher's mark as if it were its own. On Tuesday 6
--    Oct Maurice Ekpo marked Nneoma Kalu and Chiasokam Ike-Ene present in
--    12a/Bi1, then Kingsley Eze's Math Catch-up register (opened before
--    migration 384 took Year 12 off it) saved them absent. Rule (the
--    principal): a timetabled lesson always beats the Other Half. A student
--    who has a teaching lesson (not Mentor, Prep or Personal Study, by
--    homework_is_teaching_subject(): 109/Pr1 is a Prep class with no teacher
--    in the OH period) at that period on that day can't be marked from an OH
--    register at all, whatever order the two teachers save in.
--
-- 2. Two staff of the same activity both took its register. 41 of the 46
--    activities have two or more staff; the change history shows a second
--    person re-saving or changing the first one's marks at least 15 times
--    since 28 Sept (e.g. Fine Arts, 29 Sept: 5 marks changed). The
--    principal's rules:
--      * While someone has the register open, nobody else can take it:
--        "Bessie Maduekwe is taking this register (opened 15:02)". Opening it
--        holds it; it is let go on saving, on leaving the page, or after 10
--        minutes without activity, so a forgotten tab can't block it.
--      * Once saved, it belongs to whoever took it. Only they, the school
--        office, the attendance officer and SMT can change it (corrections,
--        e.g. a late arrival); the activity's other staff see it read-only.
--      * OH registers only. Lesson registers keep the 3 Oct rule that any
--        member of staff can mark any register.
--
-- other_half_register_claims holds one row per (activity, date): who has it
-- open (open_by, last_seen_at) and who took it (taken_by, taken_at). Logins
-- (auth.uid()), not staff ids, since some admin logins have no staff record
-- and the staff_id the page sends is a claim. No grants: read and written
-- only by the functions below. The page opens a register with
-- open_other_half_register(), keeps it with keep_other_half_register() as
-- marks change, and lets go with release_other_half_register(). The rule
-- itself is in the attendance trigger, so an old page or a copied request
-- gets the same answer. Writes by SECURITY DEFINER functions (planned
-- absences) and from the SQL editor aren't checked, as with
-- attendance_planned_link_guard().

set local formwork.change_note = 'Principal (direct)';

create table public.other_half_register_claims (
  id bigint generated always as identity primary key,
  activity_id bigint not null references public.other_half_activities(activity_id),
  attend_date date not null,
  open_by uuid,
  opened_at timestamptz,
  last_seen_at timestamptz,
  taken_by uuid,
  taken_at timestamptz
);
create unique index other_half_register_claims_activity_date
  on public.other_half_register_claims (activity_id, attend_date);
alter table public.other_half_register_claims enable row level security;

-- The teaching lesson a student has at a period on a date, if any.
create or replace function public.student_lesson_at(p_student_id integer, p_date date, p_period integer)
returns table (class_code text, teacher_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.class_code, nullif(trim(coalesce(st.first_name, '') || ' ' || coalesce(st.last_name, '')), '')
    from student_class sc
    join classes c on c.class_id = sc.class_id
    join timetable_slots ts on ts.class_id = c.class_id
                           and ts.period_number = p_period
                           and ts.day_of_week = to_char(p_date, 'Dy')
    left join staff st on st.staff_id = coalesce(ts.staff_id, c.staff_id)
   where sc.student_id = p_student_id
     and coalesce(sc.joined_on, p_date) <= p_date
     and homework_is_teaching_subject(c.subject_id)
   order by c.class_code
   limit 1;
$$;
revoke execute on function public.student_lesson_at(integer, date, integer) from public, anon, authenticated;

create or replace function public.other_half_register_correctors()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select has_staff_role(array['school_office', 'attendance_officer', 'smt']);
$$;
revoke execute on function public.other_half_register_correctors() from public, anon;

-- Why the caller can't write to this register now, or null if they can.
create or replace function public.other_half_register_problem(p_claim public.other_half_register_claims)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_claim.taken_by is not null and p_claim.taken_by <> auth.uid()
     and not other_half_register_correctors() then
    return format('%s took this register%s. Only they, the school office, the attendance officer or SMT can change it now.',
                  coalesce(profile_display_name(p_claim.taken_by), 'Someone else'),
                  coalesce(' at ' || to_char(p_claim.taken_at at time zone 'Africa/Lagos', 'HH24:MI'), ''));
  end if;
  if p_claim.open_by is not null and p_claim.open_by <> auth.uid()
     and p_claim.last_seen_at > now() - interval '10 minutes' then
    return format('%s is taking this register (opened at %s). You can take it once they have saved it.',
                  coalesce(profile_display_name(p_claim.open_by), 'Someone else'),
                  to_char(p_claim.opened_at at time zone 'Africa/Lagos', 'HH24:MI'));
  end if;
  return null;
end;
$$;
revoke execute on function public.other_half_register_problem(public.other_half_register_claims) from public, anon, authenticated;

-- The claim row for a register, created if missing and locked for the rest
-- of the transaction.
create or replace function public.other_half_register_claim(p_activity_id bigint, p_date date)
returns public.other_half_register_claims
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c other_half_register_claims;
begin
  insert into other_half_register_claims (activity_id, attend_date)
  values (p_activity_id, p_date)
  on conflict (activity_id, attend_date) do nothing;
  select * into c from other_half_register_claims
   where activity_id = p_activity_id and attend_date = p_date
   for update;
  return c;
end;
$$;
revoke execute on function public.other_half_register_claim(bigint, date) from public, anon, authenticated;

-- Open a register: hold it if nobody else may, and say who is in a lesson.
create or replace function public.open_other_half_register(p_activity_id bigint, p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c other_half_register_claims;
  problem text;
  oh_period integer;
  in_lesson jsonb;
begin
  if auth.uid() is null or not is_staff_or_admin() then
    raise exception 'Only staff can open an Other Half register.';
  end if;
  if not exists (select 1 from other_half_activities where activity_id = p_activity_id) then
    raise exception 'That activity doesn''t exist.';
  end if;

  c := other_half_register_claim(p_activity_id, p_date);
  problem := other_half_register_problem(c);
  if problem is null then
    update other_half_register_claims
       set opened_at = case when open_by = auth.uid() and last_seen_at > now() - interval '10 minutes'
                            then opened_at else now() end,
           open_by = auth.uid(),
           last_seen_at = now()
     where id = c.id;
  end if;

  select period_number into oh_period from periods where short_label = 'OH' limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('student_id', s.student_id,
                                               'class_code', l.class_code,
                                               'teacher_name', l.teacher_name)), '[]'::jsonb)
    into in_lesson
    from (select student_id from other_half_choices where activity_id = p_activity_id
          union
          select student_id from attendance
           where other_half_activity_id = p_activity_id and attend_date = p_date) s
    cross join lateral student_lesson_at(s.student_id, p_date, oh_period) l;

  return jsonb_build_object(
    'can_edit', problem is null,
    'message', problem,
    'taken_by_name', case when c.taken_by is not null then profile_display_name(c.taken_by) end,
    'taken_at', c.taken_at,
    'in_lesson', in_lesson);
end;
$$;
revoke execute on function public.open_other_half_register(bigint, date) from public, anon;
grant execute on function public.open_other_half_register(bigint, date) to authenticated;

-- Called as marks change: keeps the register held. False if it has been lost
-- (someone else opened it after 10 minutes without activity).
create or replace function public.keep_other_half_register(p_activity_id bigint, p_date date)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c other_half_register_claims;
begin
  if auth.uid() is null or not is_staff_or_admin() then
    return false;
  end if;
  c := other_half_register_claim(p_activity_id, p_date);
  if other_half_register_problem(c) is not null then
    return false;
  end if;
  update other_half_register_claims
     set opened_at = case when open_by = auth.uid() and last_seen_at > now() - interval '10 minutes'
                          then opened_at else now() end,
         open_by = auth.uid(),
         last_seen_at = now()
   where id = c.id;
  return true;
end;
$$;
revoke execute on function public.keep_other_half_register(bigint, date) from public, anon;
grant execute on function public.keep_other_half_register(bigint, date) to authenticated;

-- On saving or leaving the page.
create or replace function public.release_other_half_register(p_activity_id bigint, p_date date)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update other_half_register_claims
     set open_by = null, opened_at = null, last_seen_at = null
   where activity_id = p_activity_id and attend_date = p_date
     and open_by = auth.uid();
$$;
revoke execute on function public.release_other_half_register(bigint, date) from public, anon;
grant execute on function public.release_other_half_register(bigint, date) to authenticated;

-- The check on each OH mark saved from the app. Runs as the signed-in user's
-- trigger, so it is executable by authenticated; it only ever acts for
-- auth.uid() and only stamps who took the register once the save is allowed.
create or replace function public.other_half_register_check(p_activity_id bigint, p_date date,
                                                            p_student_id integer, p_period integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c other_half_register_claims;
  problem text;
  l record;
  who text;
begin
  if auth.uid() is null or not is_staff_or_admin() then
    raise exception 'Only staff can take an Other Half register.';
  end if;
  select * into l from student_lesson_at(p_student_id, p_date, p_period);
  if found then
    select first_name || ' ' || last_name into who from students where student_id = p_student_id;
    raise exception '% has a lesson then (%), so they can''t be marked on an Other Half register.',
      coalesce(who, 'This student'),
      l.class_code || coalesce(', ' || l.teacher_name, '');
  end if;

  c := other_half_register_claim(p_activity_id, p_date);
  problem := other_half_register_problem(c);
  if problem is not null then
    raise exception '%', problem;
  end if;
  update other_half_register_claims
     set taken_by = coalesce(taken_by, auth.uid()),
         taken_at = coalesce(taken_at, now())
   where id = c.id;
end;
$$;
revoke execute on function public.other_half_register_check(bigint, date, integer, integer) from public, anon;
grant execute on function public.other_half_register_check(bigint, date, integer, integer) to authenticated;

-- Not SECURITY DEFINER, so current_user tells an app save ('authenticated')
-- from a planned absence or the SQL editor.
create or replace function public.other_half_register_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' or new.other_half_activity_id is null then
    return new;
  end if;
  perform other_half_register_check(new.other_half_activity_id, new.attend_date,
                                    new.student_id, new.period_number);
  return new;
end;
$$;

create trigger trg_other_half_register_guard
  before insert or update on public.attendance
  for each row execute function public.other_half_register_guard();

-- Registers already taken: whoever saved the earliest mark still in each.
-- attendance keeps no time, so these have no taken_at.
insert into public.other_half_register_claims (activity_id, attend_date, taken_by)
select distinct on (a.other_half_activity_id, a.attend_date)
       a.other_half_activity_id, a.attend_date, p.id
  from public.attendance a
  join public.profiles p on p.staff_id = a.staff_id
 where a.other_half_activity_id is not null
   and a.planned_absence_id is null
 order by a.other_half_activity_id, a.attend_date, a.attendance_id
on conflict (activity_id, attend_date) do nothing;
