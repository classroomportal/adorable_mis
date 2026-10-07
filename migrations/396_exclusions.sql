-- Migration 396: recording exclusions (internal and sent home), and X marks
-- only the principal and the college secretary can touch.
--
-- Why (the principal, 7 Oct 2026): "We sometimes internally exclude people
-- from lessons and we sometimes exclude people by sending them home. These
-- exclusions are only done by cs and principal and I am the only person who
-- authorises the latter. We need a button that is visible to cs and principal
-- to record any internal suspension - registers need to be marked ... and the
-- details go home." And: "the code for exclusion is X - don't change, but once
-- entered no one should change other than cs and principal".
--
-- The principal's rules:
--   * Both kinds are marked X ("Excluded from school") in the registers; no
--     codes change.
--   * An internal exclusion (out of lessons, in school) is recorded by the
--     principal or the college secretary; an exclusion home by the principal
--     only. Holding the role in staff_roles is what counts (holds_staff_role),
--     so being admin is not enough.
--   * Once an X mark or an X planned absence exists, nobody else can enter,
--     change or remove one: not teachers, not the office, not pastoral, not
--     admin. Before this the office entered exclusions on Planned Absences and
--     could change them like any other code.
--   * The details go home: every parent linked to the student is emailed (the
--     reason, the days and the lessons) and gets the same notice in their
--     portal inbox. Ending an exclusion early or cancelling it tells them too.
--
-- How:
--   1. exclusions: one row per exclusion, with the reason sent home. It sits
--      on a planned absence (code X) so the register marks are filled in the
--      same way (migrations 318 and 389): past days and today at once, later
--      days by the 05:30 cron. Unlike a planned absence, an exclusion
--      overwrites marks already in the registers for the lessons it covers:
--      the principal or the college secretary is the last word on where the
--      student was (a teacher's N for an excluded student also withdraws the
--      automatic missed-lesson negative through trg_withdraw_missed_lesson_negative).
--   2. record_exclusion() / end_exclusion(): the only way in. Select policy for
--      the two of them, SMT and pastoral; no write grants.
--   3. trg_attendance_exclusion_guard on attendance and
--      trg_planned_absence_exclusion_guard on planned_absences: anyone signed
--      in (auth.uid() not null) who isn't the principal or the college
--      secretary is refused any insert, change or delete that involves X,
--      including through SECURITY DEFINER functions such as plan_absence(),
--      end_planned_absence_from(), change_planned_absence_code() and
--      office_set_student_marks(), which the existing planned-absence guard
--      lets through. The cron (no auth.uid()) and the SQL editor pass.
--   4. Parents: notify_exclusion_parents(), email through queue_workspace_email
--      with a new reply route 'exclusion' (replies go to whoever recorded it,
--      and to principal@)
--      and post_inbox_notice (kind 'exclusion'). Links marked "Other" to a
--      parent whose email is a member of staff's (principal@ and cs@ follow
--      students through the parent portal) are left out. While parent emails
--      are paused (migration 114) parents still get the inbox notice.
--   5. Logged under change_history area 'exclusions'.
--   6. Page /attendance/exclusions, granted to principal and college_secretary.

set local formwork.change_note = 'Principal (direct)';

-- 1. Who may ---------------------------------------------------------------------------------
create or replace function public.can_record_exclusion(p_kind text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case p_kind
    when 'internal' then holds_staff_role('principal') or holds_staff_role('college_secretary')
    when 'external' then holds_staff_role('principal')
    else false
  end;
$$;

revoke execute on function public.can_record_exclusion(text) from public, anon;
grant execute on function public.can_record_exclusion(text) to authenticated;

-- Who may touch an X mark or an X planned absence at all.
create or replace function public.can_change_exclusion_marks()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select holds_staff_role('principal') or holds_staff_role('college_secretary');
$$;

revoke execute on function public.can_change_exclusion_marks() from public, anon;
grant execute on function public.can_change_exclusion_marks() to authenticated;

-- 2. The table -------------------------------------------------------------------------------
create table public.exclusions (
  id bigint generated always as identity primary key,
  student_id integer not null references public.students(student_id),
  kind text not null check (kind in ('internal', 'external')),
  start_date date not null,
  end_date date not null,
  start_period integer references public.periods(period_number),
  end_period integer references public.periods(period_number),
  reason text not null check (length(btrim(reason)) between 1 and 2000),
  planned_absence_id bigint not null unique references public.planned_absences(id),
  recorded_by uuid,
  recorded_by_staff_id integer references public.staff(staff_id),
  recorded_at timestamptz not null default now(),
  parents_emailed integer not null default 0,
  parents_inboxed integer not null default 0,
  ended_at timestamptz,
  ended_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  check (end_date >= start_date),
  check (start_date <> end_date or start_period is null or end_period is null or end_period >= start_period)
);

create index exclusions_student_idx on public.exclusions (student_id, start_date desc);

alter table public.exclusions enable row level security;
grant select on public.exclusions to authenticated;

create policy exclusions_read on public.exclusions
  for select to authenticated
  using (can_change_exclusion_marks() or has_staff_role(array['smt', 'pastoral']));

create trigger trg_stamp_actor
  before insert on public.exclusions
  for each row execute function public.stamp_actor('recorded_by');

alter table public.change_history drop constraint change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area = any (array['registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions',
                           'groups', 'students', 'reading_ages', 'finance', 'prep', 'rewards', 'other_half',
                           'exclusions']));

create trigger trg_log_change
  after insert or update or delete on public.exclusions
  for each row execute function public.log_change('exclusions', 'id');

-- 3. X is the principal's and the college secretary's -----------------------------------------
create or replace function public.attendance_exclusion_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or can_change_exclusion_marks() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.code = 'X' then
      raise exception 'This is an exclusion mark (X). Only the principal or the college secretary can change it.'
        using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.code = 'X' then
      raise exception 'Only the principal or the college secretary can mark a student X (excluded).'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if (old.code = 'X' or new.code = 'X')
     and (new.student_id, new.attend_date, new.period_number, new.code, new.status)
         is distinct from (old.student_id, old.attend_date, old.period_number, old.code, old.status) then
    raise exception 'This is an exclusion mark (X). Only the principal or the college secretary can change it.'
      using errcode = 'insufficient_privilege';
  end if;
  if old.code = 'X' then
    -- Saved again unchanged: it stays as it was, including who gave it.
    new.staff_id := old.staff_id;
    new.planned_absence_id := old.planned_absence_id;
  end if;
  return new;
end;
$$;

create trigger trg_attendance_exclusion_guard
  before insert or update or delete on public.attendance
  for each row execute function public.attendance_exclusion_guard();

create or replace function public.planned_absence_exclusion_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or can_change_exclusion_marks() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and old.code = 'X')
     or (tg_op in ('INSERT', 'UPDATE') and new.code = 'X') then
    raise exception 'Exclusions are recorded and changed only by the principal or the college secretary, on the Exclusions page.'
      using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_planned_absence_exclusion_guard
  before insert or update or delete on public.planned_absences
  for each row execute function public.planned_absence_exclusion_guard();

-- 4. Telling parents -------------------------------------------------------------------------
insert into public.email_reply_routes
  (email_kind, label, description, sender_label, sort_order, reply_to_sender, reply_to_smt, addresses)
values
  ('exclusion', 'Exclusion', 'The email to parents when a student is excluded (internally or sent home), or an exclusion is ended early or cancelled. Replies go to whoever recorded it and the principal.',
   'The person who recorded the exclusion', 56, true, false, array['principal@abc.sch.ng'])
on conflict (email_kind) do nothing;

-- p_what: 'recorded', 'ended' or 'cancelled'. Returns (emailed, inboxed).
create or replace function public.notify_exclusion_parents(p_id bigint, p_what text)
returns integer[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x exclusions%rowtype;
  s students%rowtype;
  v_name text;
  v_when text;
  v_subject text;
  v_html text;
  v_emailed integer := 0;
  v_profiles uuid[];
  v_posted boolean;
  r record;
begin
  select * into x from exclusions where id = p_id;
  select * into s from students where student_id = x.student_id;
  v_name := html_escape(s.first_name || ' ' || s.last_name);

  v_when := case
    when x.start_date = x.end_date then
      to_char(x.start_date, 'FMDay FMDD FMMonth YYYY')
      || case when x.start_period is null and x.end_period is null then ' (the whole day)'
              else ', from ' || coalesce((select period_name from periods where period_number = x.start_period), 'the start of the day')
                   || ' to ' || coalesce((select period_name from periods where period_number = x.end_period), 'the end of the day') end
    else
      to_char(x.start_date, 'FMDay FMDD FMMonth YYYY')
      || coalesce(' from ' || (select period_name from periods where period_number = x.start_period), '')
      || ' to ' || to_char(x.end_date, 'FMDay FMDD FMMonth YYYY')
      || coalesce(' until the end of ' || (select period_name from periods where period_number = x.end_period), ' (inclusive)')
  end;

  if p_what = 'recorded' then
    v_subject := case x.kind when 'internal' then 'Internal exclusion: ' else 'Exclusion from school: ' end
                 || s.first_name || ' ' || s.last_name;
    v_html := '<p>Dear Parent or Guardian,</p>'
      || case x.kind
           when 'internal' then
             '<p>We are writing to let you know that ' || v_name || ' has been internally excluded from lessons on '
             || html_escape(v_when) || '.</p>'
             || '<p>' || v_name || ' will be in school during this time, working away from lessons under supervision. '
             || 'The register is marked X (excluded) for the lessons missed.</p>'
           else
             '<p>We are writing to let you know that ' || v_name || ' has been excluded from school on '
             || html_escape(v_when) || '.</p>'
             || '<p>' || v_name || ' must not attend school during this time. The register is marked X (excluded).</p>'
         end
      || '<p><strong>Reason:</strong><br/>' || replace(html_escape(btrim(x.reason)), E'\n', '<br/>') || '</p>'
      || '<p>If you would like to discuss this, please reply to this email.</p>'
      || '<p>Adorable British College</p>';
  else
    v_subject := 'Exclusion ' || case p_what when 'cancelled' then 'cancelled' else 'ended early' end
                 || ': ' || s.first_name || ' ' || s.last_name;
    v_html := '<p>Dear Parent or Guardian,</p>'
      || case p_what
           when 'cancelled' then
             '<p>The exclusion we told you about for ' || v_name || ' has been cancelled. '
             || 'The X marks it placed in the registers have been removed.</p>'
           else
             '<p>The exclusion we told you about for ' || v_name || ' has been ended early. It now runs '
             || html_escape(v_when) || '.</p>'
         end
      || '<p>If you would like to discuss this, please reply to this email.</p>'
      || '<p>Adorable British College</p>';
  end if;

  for r in
    select distinct p.parent_id, lower(btrim(p.email)) as email
      from student_parent sp
      join parents p on p.parent_id = sp.parent_id
     where sp.student_id = x.student_id
       and not (coalesce(sp.relationship, p.relationship_type) = 'Other'
                and exists (select 1 from staff st where lower(btrim(st.email)) = lower(btrim(p.email))))
  loop
    if r.email is not null and is_plain_email(r.email) and not parent_emails_paused() then
      perform queue_workspace_email(jsonb_build_object(
        'to', r.email,
        'subject', v_subject,
        'html', v_html,
        'reply_to', email_reply_to('exclusion')));
      v_emailed := v_emailed + 1;
    end if;
  end loop;

  select array_agg(distinct pr.id) into v_profiles
    from profiles pr
   where pr.parent_id in (
     select sp.parent_id
       from student_parent sp
       join parents p on p.parent_id = sp.parent_id
      where sp.student_id = x.student_id
        and not (coalesce(sp.relationship, p.relationship_type) = 'Other'
                 and exists (select 1 from staff st where lower(btrim(st.email)) = lower(btrim(p.email)))));

  v_posted := post_inbox_notice(v_profiles, v_subject, v_html, 'exclusion');
  return array[v_emailed, case when v_posted then cardinality(v_profiles) else 0 end];
end;
$$;

revoke execute on function public.notify_exclusion_parents(bigint, text) from public, anon, authenticated;

-- 5. Recording and ending --------------------------------------------------------------------
create or replace function public.record_exclusion(
  p_student_id integer,
  p_kind text,
  p_start date,
  p_end date,
  p_reason text,
  p_start_period integer default null,
  p_end_period integer default null
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
  v_overwritten integer;
  v_added integer;
  v_told integer[];
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

  insert into exclusions (student_id, kind, start_date, end_date, start_period, end_period, reason,
                          planned_absence_id, recorded_by_staff_id)
  values (p_student_id, p_kind, p_start, p_end, p_start_period, p_end_period, btrim(p_reason), v_pa, v_staff)
  returning id into v_id;

  -- Marks already in the registers for these lessons become X.
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
                           'parents_emailed', v_told[1], 'parents_inboxed', v_told[2],
                           'parent_emails_paused', parent_emails_paused());
end;
$$;

revoke execute on function public.record_exclusion(integer, text, date, date, text, integer, integer) from public, anon;
grant execute on function public.record_exclusion(integer, text, date, date, text, integer, integer) to authenticated;

-- p_back_on / p_back_period: the first day and lesson the student is back
-- (no lesson = the start of the day). At or before the start, the whole
-- exclusion is cancelled. Either way the parents are told.
create or replace function public.end_exclusion(p_id bigint, p_back_on date, p_back_period integer default null)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  x exclusions%rowtype;
  v_removed integer;
  v_first_period integer := (select min(period_number) from periods);
  v_cancelled boolean;
  v_told integer[];
begin
  select * into x from exclusions where id = p_id for update;
  if not found or x.cancelled_at is not null then
    raise exception 'That exclusion no longer exists or was already cancelled.';
  end if;
  if not can_record_exclusion(x.kind) then
    raise exception '%', case x.kind
      when 'external' then 'Only the principal can change an exclusion from school.'
      else 'Only the principal or the college secretary can change an internal exclusion.' end
      using errcode = 'insufficient_privilege';
  end if;
  if p_back_on is null then
    raise exception 'Choose the day the student is back.';
  end if;
  if p_back_period is not null and not exists (select 1 from periods where period_number = p_back_period) then
    raise exception 'Choose a lesson from the list.' using errcode = 'check_violation';
  end if;
  if p_back_period = v_first_period then
    p_back_period := null;
  end if;
  if (p_back_on, coalesce(p_back_period, 0)) > (x.end_date, coalesce(x.end_period, 99)) then
    raise exception 'That exclusion already ends before then.' using errcode = 'check_violation';
  end if;

  delete from attendance a
   where a.planned_absence_id = x.planned_absence_id
     and (a.attend_date > p_back_on
          or (a.attend_date = p_back_on and a.period_number >= coalesce(p_back_period, 0)));
  get diagnostics v_removed = row_count;

  v_cancelled := (p_back_on, coalesce(p_back_period, 0)) <= (x.start_date, coalesce(x.start_period, 0));
  if v_cancelled then
    update planned_absences set cancelled_at = now(), cancelled_by = auth.uid() where id = x.planned_absence_id;
    update exclusions set cancelled_at = now(), cancelled_by = auth.uid() where id = p_id;
  elsif p_back_period is null then
    update planned_absences set end_date = p_back_on - 1, end_period = null where id = x.planned_absence_id;
    update exclusions set end_date = p_back_on - 1, end_period = null, ended_at = now(), ended_by = auth.uid() where id = p_id;
  else
    update planned_absences set end_date = p_back_on, end_period = p_back_period - 1 where id = x.planned_absence_id;
    update exclusions set end_date = p_back_on, end_period = p_back_period - 1, ended_at = now(), ended_by = auth.uid() where id = p_id;
  end if;

  v_told := notify_exclusion_parents(p_id, case when v_cancelled then 'cancelled' else 'ended' end);
  return json_build_object('cancelled', v_cancelled, 'marks_removed', v_removed,
                           'parents_emailed', v_told[1], 'parents_inboxed', v_told[2]);
end;
$$;

revoke execute on function public.end_exclusion(bigint, date, integer) from public, anon;
grant execute on function public.end_exclusion(bigint, date, integer) to authenticated;

-- 6. The page --------------------------------------------------------------------------------
insert into public.resources (resource_key, label, section, sort_order)
values ('/attendance/exclusions', 'Exclusions', 'Attendance', 27)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('principal', '/attendance/exclusions'),
  ('college_secretary', '/attendance/exclusions')
on conflict do nothing;
