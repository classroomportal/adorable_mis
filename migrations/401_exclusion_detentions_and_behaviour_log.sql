-- Migration 401: an exclusion goes on the behaviour log, and chooses which
-- detentions it replaces.
--
-- Why (the principal, 8 Oct 2026): "The exclusion needs to be recorded on the
-- student's behaviour log." And: "An exclusion clears the detentions related
-- to it. Someone who has two Friday detentions would be eligible for internal
-- exclusion. We still decide but we should choose which detentions are
-- cancelled but points kept. A third internal suspension in a half term might
-- end up as external exclusion but again this is a decision we make."
--
-- The principal's rules, as built:
--   * Recording an exclusion adds a behaviour event on the student's log:
--     negative, 0 points, category "Internal exclusion" or "Exclusion from
--     school", the days and the reason in the explanation. 0 points so it
--     never sets off a detention (trg_negative_behaviour only fires below 0),
--     and the behaviour alert no longer fires for a 0-point event either (it
--     would otherwise re-send the week's alert). It starts hidden from
--     parents and marked reviewed (by the person who recorded it), so it
--     stays out of the Behaviour Review queues: the parents have already had
--     the exclusion email. Students see their own events as before.
--   * The person recording ticks which of the student's detentions not yet
--     held the exclusion replaces. Those detentions are cancelled (the
--     student is told, as for any cancelled detention); the behaviour events
--     behind them keep their points. Nothing is cancelled automatically.
--   * The page shows, to help the decision and never to decide it: the
--     student's Friday detentions this half term (held or still to come) and
--     their internal exclusions this half term. A half term runs from the
--     start of the term, or the day after its mid-term break, to the break or
--     the end of the term (holiday events named "Mid term" / "Mid-term break"
--     on the calendar).
--   * The two categories are system categories (behaviour_categories.system_only):
--     not offered on Log behaviour or when changing a category, not editable
--     at Lookups, and an event in them can be added, changed or removed only
--     by the principal or the college secretary (the same people who can
--     touch an X mark).
--   * Cancelling an exclusion withdraws its behaviour event (voided, so it
--     shows crossed out). Detentions it cancelled stay cancelled.
--
-- record_exclusion() gains p_cancel_detention_ids (a new 8-argument function;
-- 396's 7-argument one is no longer callable from the app).

set local formwork.change_note = 'Principal (direct)';

-- 1. System categories ------------------------------------------------------------------------
alter table public.behaviour_categories
  add column if not exists system_only boolean not null default false;

insert into public.behaviour_categories (name, type, default_points, description, retired, system_only)
select v.name, 'negative', 0, v.description, false, true
  from (values
    ('Internal exclusion', 'Recorded automatically from Exclusions (principal or college secretary). Out of lessons, in school. 0 points.'),
    ('Exclusion from school', 'Recorded automatically from Exclusions (principal only). Sent home. 0 points.')
  ) v(name, description)
 where not exists (select 1 from public.behaviour_categories c where c.name = v.name and c.type = 'negative');

update public.behaviour_categories
   set system_only = true, default_points = 0
 where type = 'negative' and name in ('Internal exclusion', 'Exclusion from school');

-- The app can't change a system category, or make one.
create or replace function public.behaviour_category_system_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and old.system_only)
     or (tg_op in ('INSERT', 'UPDATE') and new.system_only) then
    raise exception 'The exclusion categories are set by the system and can''t be changed here.'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger behaviour_category_system_guard
  before insert or update or delete on public.behaviour_categories
  for each row execute function public.behaviour_category_system_guard();

-- 2. Exclusion events are the principal's and the college secretary's ---------------------------
-- Checks auth.uid(), not current_user, so edit_behaviour_event() and the
-- other SECURITY DEFINER functions are caught too.
create or replace function public.behaviour_event_exclusion_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or can_change_exclusion_marks() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op in ('UPDATE', 'DELETE')
      and exists (select 1 from behaviour_categories c where c.system_only and c.name = old.category and c.type = old.type))
     or (tg_op in ('INSERT', 'UPDATE')
      and exists (select 1 from behaviour_categories c where c.system_only and c.name = new.category and c.type = new.type)) then
    raise exception 'Exclusions are recorded and changed only by the principal or the college secretary, on the Exclusions page.'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger behaviour_event_exclusion_guard
  before insert or update or delete on public.behaviour_events
  for each row execute function public.behaviour_event_exclusion_guard();

-- 3. No behaviour alert for a 0-point event ------------------------------------------------------
create or replace trigger trg_notify_pastoral_on_negative_behaviour
  after insert on public.behaviour_events
  for each row when (new.type = 'negative' and new.points is distinct from 0)
  execute function public.notify_pastoral_on_negative_behaviour();

-- 4. What an exclusion did ----------------------------------------------------------------------
alter table public.exclusions
  add column if not exists behaviour_event_id integer references public.behaviour_events(event_id),
  add column if not exists cancelled_detention_ids integer[] not null default '{}';

-- 5. Half terms -------------------------------------------------------------------------------------
create or replace function public.half_term_bounds(p_day date)
returns table (from_date date, to_date date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with t as (
    select start_date, end_date from terms
     where start_date <= p_day
     order by start_date desc limit 1
  ), mid as (
    select ce.event_date from calendar_events ce, t
     where ce.category = 'holiday'
       and (ce.event_name ilike '%mid%term%')
       and ce.event_date between t.start_date and t.end_date
  )
  select greatest(t.start_date, coalesce((select max(event_date) + 1 from mid where event_date < p_day), t.start_date)),
         least(t.end_date, coalesce((select min(event_date) - 1 from mid where event_date >= p_day), t.end_date))
    from t;
$$;

revoke execute on function public.half_term_bounds(date) from public, anon;
grant execute on function public.half_term_bounds(date) to authenticated;

-- 6. What the Exclusions page shows before recording -------------------------------------------------
create or replace function public.exclusion_context(p_student_id integer)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_from date;
  v_to date;
begin
  if not can_change_exclusion_marks() then
    raise exception 'Only the principal or the college secretary can record exclusions.'
      using errcode = 'insufficient_privilege';
  end if;
  select from_date, to_date into v_from, v_to from half_term_bounds(school_today());
  v_from := coalesce(v_from, school_today());
  v_to := coalesce(v_to, school_today());

  return json_build_object(
    'half_term_from', v_from,
    'half_term_to', v_to,
    'detentions', coalesce((
      select json_agg(json_build_object(
               'detention_id', d.detention_id,
               'detention_date', d.detention_date,
               'status', d.status,
               'reason', detention_reason(d.detention_id),
               'can_cancel', d.status = 'scheduled' and d.detention_date >= school_today())
             order by d.detention_date, d.detention_id)
        from detentions d
       where d.student_id = p_student_id and not d.is_demo
         and d.status <> 'cancelled'
         and (d.detention_date between v_from and v_to
              or (d.status = 'scheduled' and d.detention_date >= school_today()))), '[]'::json),
    'internal_exclusions', coalesce((
      select json_agg(json_build_object('id', x.id, 'start_date', x.start_date, 'end_date', x.end_date) order by x.start_date)
        from exclusions x
       where x.student_id = p_student_id and x.kind = 'internal' and x.cancelled_at is null
         and x.start_date between v_from and v_to), '[]'::json),
    'external_exclusions', coalesce((
      select json_agg(json_build_object('id', x.id, 'start_date', x.start_date, 'end_date', x.end_date) order by x.start_date)
        from exclusions x
       where x.student_id = p_student_id and x.kind = 'external' and x.cancelled_at is null
         and x.start_date between v_from and v_to), '[]'::json)
  );
end;
$$;

revoke execute on function public.exclusion_context(integer) from public, anon;
grant execute on function public.exclusion_context(integer) to authenticated;

-- 7. Recording -----------------------------------------------------------------------------------------
create or replace function public.record_exclusion(
  p_student_id integer,
  p_kind text,
  p_start date,
  p_end date,
  p_reason text,
  p_start_period integer,
  p_end_period integer,
  p_cancel_detention_ids integer[]
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clash planned_absences%rowtype;
  v_pa bigint;
  v_id bigint;
  v_staff integer := (select p.staff_id from profiles p where p.id = auth.uid());
  v_ids integer[] := coalesce((select array_agg(distinct i) from unnest(p_cancel_detention_ids) i where i is not null), '{}');
  v_cancelled integer;
  v_overwritten integer;
  v_added integer;
  v_told integer[];
  v_event integer;
  v_when text;
  v_det text;
begin
  if p_kind not in ('internal', 'external') then
    raise exception 'Choose internal exclusion or exclusion from school.';
  end if;
  if not can_record_exclusion(p_kind) then
    raise exception '%', case p_kind
      when 'external' then 'Only the principal can record an exclusion from school.'
      else 'Only the principal or the college secretary can record an internal exclusion.' end
      using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Write the reason. It is sent to the parents.' using errcode = 'check_violation';
  end if;
  if length(btrim(p_reason)) > 2000 then
    raise exception 'The reason can be at most 2000 characters.' using errcode = 'check_violation';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'The last day must be on or after the first day.' using errcode = 'check_violation';
  end if;
  if p_end - p_start > 90 then
    raise exception 'An exclusion can be at most 90 days long.' using errcode = 'check_violation';
  end if;
  if (p_start_period is not null and not exists (select 1 from periods where period_number = p_start_period))
     or (p_end_period is not null and not exists (select 1 from periods where period_number = p_end_period)) then
    raise exception 'Choose a lesson from the list.' using errcode = 'check_violation';
  end if;
  if p_start = p_end and p_start_period is not null and p_end_period is not null and p_end_period < p_start_period then
    raise exception 'The last lesson must be the same as or after the first lesson.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from students s where s.student_id = p_student_id and s.status = 'active') then
    raise exception 'That student is not on roll.' using errcode = 'check_violation';
  end if;
  if cardinality(v_ids) > 0 and (
       select count(*) from detentions d
        where d.detention_id = any (v_ids) and d.student_id = p_student_id
          and d.status = 'scheduled' and d.detention_date >= school_today()) <> cardinality(v_ids) then
    raise exception 'Only this student''s detentions that haven''t been held yet can be cancelled.'
      using errcode = 'check_violation';
  end if;

  select * into v_clash from planned_absences pa
   where pa.student_id = p_student_id and pa.cancelled_at is null
     and (pa.start_date, coalesce(pa.start_period, 0)) <= (p_end, coalesce(p_end_period, 99))
     and (pa.end_date, coalesce(pa.end_period, 99)) >= (p_start, coalesce(p_start_period, 0))
   limit 1;
  if found then
    raise exception 'This student already has a planned absence (%) from % to %. End or cancel it first.',
      v_clash.code, to_char(v_clash.start_date, 'Dy DD Mon YYYY'), to_char(v_clash.end_date, 'Dy DD Mon YYYY')
      using errcode = 'check_violation';
  end if;

  insert into planned_absences (student_id, start_date, end_date, start_period, end_period, code, notes, created_by_staff_id)
  values (p_student_id, p_start, p_end, p_start_period, p_end_period, 'X',
          case p_kind when 'internal' then 'Internal exclusion' else 'Exclusion from school' end
            || ' (recorded on Exclusions)',
          v_staff)
  returning id into v_pa;

  -- The detentions it replaces: cancelled, their events keep their points.
  update detentions set status = 'cancelled'
   where detention_id = any (v_ids) and student_id = p_student_id
     and status = 'scheduled' and detention_date >= school_today();
  get diagnostics v_cancelled = row_count;
  select string_agg(to_char(d.detention_date, 'Dy DD Mon'), ', ' order by d.detention_date) into v_det
    from detentions d where d.detention_id = any (v_ids);

  -- On the behaviour log: 0 points, hidden from parents (they have the
  -- email), marked reviewed so it stays out of the review queues.
  v_when := to_char(p_start, 'Dy DD Mon YYYY')
    || coalesce(' from ' || (select period_name from periods where period_number = p_start_period), '')
    || case when p_end = p_start then '' else ' to ' || to_char(p_end, 'Dy DD Mon YYYY') end
    || coalesce(case when p_end = p_start then ' to ' else ' until ' end
                || (select period_name from periods where period_number = p_end_period), '');
  insert into behaviour_events (student_id, event_date, type, category, description,
                                visible_to_parents, protocol_reviewed_by, protocol_reviewed_at)
  values (p_student_id, school_today(), 'negative',
          case p_kind when 'internal' then 'Internal exclusion' else 'Exclusion from school' end,
          v_when || '. ' || btrim(p_reason)
            || coalesce(E'\nDetentions replaced (points kept): ' || v_det || '.', ''),
          false, v_staff, now())
  returning event_id into v_event;

  insert into exclusions (student_id, kind, start_date, end_date, start_period, end_period, reason,
                          planned_absence_id, recorded_by_staff_id, behaviour_event_id, cancelled_detention_ids)
  values (p_student_id, p_kind, p_start, p_end, p_start_period, p_end_period, btrim(p_reason), v_pa, v_staff,
          v_event, v_ids)
  returning id into v_id;

  update attendance a
     set code = 'X', status = 'authorized_absence', minutes_late = null,
         planned_absence_id = v_pa, staff_id = coalesce(v_staff, a.staff_id)
   where a.student_id = p_student_id
     and (a.attend_date, a.period_number) >= (p_start, coalesce(p_start_period, 0))
     and (a.attend_date, a.period_number) <= (p_end, coalesce(p_end_period, 99))
     and a.planned_absence_id is distinct from v_pa;
  get diagnostics v_overwritten = row_count;

  v_added := planned_absence_apply_days(v_pa, p_start, p_end);

  v_told := notify_exclusion_parents(v_id, 'recorded');
  update exclusions set parents_emailed = v_told[1], parents_inboxed = v_told[2] where id = v_id;

  return json_build_object('id', v_id, 'marks_added', v_added, 'marks_changed', v_overwritten,
                           'detentions_cancelled', v_cancelled, 'behaviour_event_id', v_event,
                           'parents_emailed', v_told[1], 'parents_inboxed', v_told[2],
                           'parent_emails_paused', parent_emails_paused());
end;
$$;

revoke execute on function public.record_exclusion(integer, text, date, date, text, integer, integer, integer[]) from public, anon;
grant execute on function public.record_exclusion(integer, text, date, date, text, integer, integer, integer[]) to authenticated;

-- One way in.
revoke execute on function public.record_exclusion(integer, text, date, date, text, integer, integer) from authenticated;

-- 8. Cancelling an exclusion withdraws its behaviour event -----------------------------------------
create or replace function public.exclusion_cancel_withdraws_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cancelled_at is not null and old.cancelled_at is null and new.behaviour_event_id is not null then
    update behaviour_events
       set voided_points = points, points = 0, voided_at = now()
     where event_id = new.behaviour_event_id and voided_at is null;
  end if;
  return null;
end;
$$;

revoke execute on function public.exclusion_cancel_withdraws_event() from public, anon, authenticated;

create trigger trg_exclusion_cancel_withdraws_event
  after update of cancelled_at on public.exclusions
  for each row execute function public.exclusion_cancel_withdraws_event();
