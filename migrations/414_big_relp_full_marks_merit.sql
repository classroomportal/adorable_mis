-- Migration 414: 100% in a Big ReLP records a merit automatically.
--
-- Why (the principal, 9 Oct 2026): "any student who gets 100% in a big ReLP
-- in a subject should be awarded 100% in big ReLP test positive, ideally with
-- a note to say which subject". The positive category "100% in a Big ReLP
-- Test" already existed but teachers had to log it by hand.
--
-- The rule:
--   * which tests: marks in a result set (results.result_set_event_id) whose
--     calendar event is category 'relp' and named like "Big ReLP" ("Week 3
--     Big Relp", "Big ReLP"). The other 'relp' set this term, "Mid Term
--     tests", is not a Big ReLP and is left out; there is no other marker on
--     the set, so a future Big ReLP must keep "Big ReLP" in its name.
--   * what counts as 100%: max_score > 0 and score >= max_score. Grade-only
--     marks never count.
--   * what: one event per (result) in the positive category "100% in a Big
--     ReLP Test" with that category's points (3 when written), dated the day
--     it is recorded, with a description naming the subject, the score and
--     the test. Only active students.
--   * who: when a teacher saves the mark, the event is logged as them
--     (set_behaviour_event_logged_by() from auth.uid()) and its class is
--     filled in the usual way. Otherwise (the back-fill below) it carries the
--     mark's staff_id and the student's class in that subject.
--   * it has writing (the subject), so it waits under "Writing to approve" on
--     /behaviour/review before parents see it (387). Students see it at once.
--
-- Correcting it withdraws it: if the mark drops below full marks, is
-- deleted, or moves to another set, student or subject, the event is voided
-- (points to 0, voided_points kept). Reaching full marks again records a
-- fresh one.
--
-- relp_full_marks_merits keeps which result produced which event, so an
-- event SMT delete is never remade while the mark stands. RLS on, no
-- policies, no grants. Its backup-mode guard is attached by guard_new_tables.
--
-- Back-filled for this school year's Big ReLP sets at the end.

set local formwork.change_note = 'Principal (direct)';

create table public.relp_full_marks_merits (
  id bigint generated always as identity primary key,
  result_id integer not null,
  student_id integer not null references public.students (student_id),
  event_id integer references public.behaviour_events (event_id) on delete set null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
-- A unique index, not a constraint (see 306). One live link per result.
create unique index relp_full_marks_merits_live
  on public.relp_full_marks_merits (result_id) where withdrawn_at is null;
create index relp_full_marks_merits_event on public.relp_full_marks_merits (event_id);

alter table public.relp_full_marks_merits enable row level security;
revoke all on public.relp_full_marks_merits from anon, authenticated;

-- Is this result set a Big ReLP? Internal.
create or replace function public.is_big_relp_set(p_event_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1 from calendar_events e
     where e.event_id = p_event_id
       and e.is_result_set
       and e.category = 'relp'
       and e.event_name ~* 'big\s*relp'
  );
$$;

revoke execute on function public.is_big_relp_set(integer) from public, anon, authenticated;

-- Records the merit for one result, unless one stands or it isn't 100%.
-- Internal (called from the trigger and the back-fill).
create or replace function public.record_relp_full_marks_merit(p_result_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_r results%rowtype;
  v_set text;
  v_subject text;
  v_category text;
  v_points integer;
  v_class_id integer;
  v_event_id integer;
begin
  select * into v_r from results where result_id = p_result_id;
  if v_r.result_id is null or v_r.result_set_event_id is null
     or not is_big_relp_set(v_r.result_set_event_id)
     or coalesce(v_r.max_score, 0) <= 0 or v_r.score is null or v_r.score < v_r.max_score then
    return;
  end if;
  if not exists (select 1 from students s
                  where s.student_id = v_r.student_id and s.status = 'active' and not s.is_demo) then
    return;
  end if;
  if exists (select 1 from relp_full_marks_merits k
              where k.result_id = p_result_id and k.withdrawn_at is null) then
    return;
  end if;

  select name, default_points into v_category, v_points
    from behaviour_categories
   where name = '100% in a Big ReLP Test' and type = 'positive' and not retired;
  if v_category is null or v_points is null then
    return;
  end if;

  select event_name into v_set from calendar_events where event_id = v_r.result_set_event_id;
  select coalesce(nullif(display_name, ''), subject_name) into v_subject from subjects where subject_id = v_r.subject_id;

  -- The student's class in that subject (one only), for the back-fill; when a
  -- teacher saves the mark set_behaviour_event_class() may fill it instead.
  select min(c.class_id) into v_class_id
    from student_class sc
    join classes c on c.class_id = sc.class_id
   where sc.student_id = v_r.student_id and c.subject_id = v_r.subject_id
  having count(*) = 1;

  insert into behaviour_events
    (student_id, staff_id, event_date, event_time, type, category, points, description, class_id)
  values
    (v_r.student_id, v_r.staff_id, school_today(), school_now()::time, 'positive', v_category, v_points,
     'Recorded automatically: 100% in ' || coalesce(v_subject, 'a subject')
       || ' (' || trim_scale(v_r.score) || '/' || trim_scale(v_r.max_score) || ', '
       || coalesce(v_set, 'Big ReLP') || ').',
     v_class_id)
  returning event_id into v_event_id;

  insert into relp_full_marks_merits (result_id, student_id, event_id)
  values (p_result_id, v_r.student_id, v_event_id);
end;
$$;

revoke execute on function public.record_relp_full_marks_merit(integer) from public, anon, authenticated;

-- Voids the standing merit for one result, if any. Internal.
create or replace function public.withdraw_relp_full_marks_merit(p_result_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_link relp_full_marks_merits%rowtype;
begin
  select * into v_link from relp_full_marks_merits
   where result_id = p_result_id and withdrawn_at is null;
  if v_link.id is null then
    return;
  end if;

  update relp_full_marks_merits set withdrawn_at = now() where id = v_link.id;

  update behaviour_events
     set voided_points = points, points = 0, voided_at = now()
   where event_id = v_link.event_id and voided_at is null;
end;
$$;

revoke execute on function public.withdraw_relp_full_marks_merit(integer) from public, anon, authenticated;

create or replace function public.results_relp_full_marks_merit()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'DELETE' then
    perform withdraw_relp_full_marks_merit(old.result_id);
    return null;
  end if;

  if tg_op = 'UPDATE'
     and (new.student_id <> old.student_id or new.subject_id <> old.subject_id
          or new.result_set_event_id is distinct from old.result_set_event_id
          or coalesce(new.max_score, 0) <= 0 or new.score is null
          or new.score < new.max_score) then
    perform withdraw_relp_full_marks_merit(new.result_id);
  end if;

  perform record_relp_full_marks_merit(new.result_id);
  return null;
end;
$$;

revoke execute on function public.results_relp_full_marks_merit() from public, anon, authenticated;

create trigger trg_results_relp_full_marks_merit
  after insert or update of score, max_score, student_id, subject_id, result_set_event_id or delete
  on public.results
  for each row
  execute function public.results_relp_full_marks_merit();

-- Back-fill: this school year's Big ReLP marks already at 100%.
select public.record_relp_full_marks_merit(r.result_id)
  from results r
  join calendar_events e on e.event_id = r.result_set_event_id
  join academic_years y on y.status = 'current'
 where public.is_big_relp_set(e.event_id)
   and e.event_date between y.start_date and y.end_date
   and r.max_score > 0 and r.score >= r.max_score;
