-- Migration 330: tickable role abilities, stage 2 (Behaviour, Attendance,
-- Reports), and migration 319's safeguards, which never reached the live
-- database.
--
-- Why (the principal, 3 Oct 2026): stage 2 of docs/role-abilities-design.md.
-- Each converted table's role-naming policies become ability_view / add /
-- edit / delete, reading the ticks in role_abilities (migration 329). The
-- ticks start as today's access. Rules tied to particular records (a
-- teacher's own comments, a report checker's period, students' and parents'
-- own records, whoever can edit an event) stay as they are.
--
-- While preparing this on 3 Oct 2026 we found migration 319 (the principal,
-- 2 Oct 2026: only SMT remove a merit or cancel a detention) was not live:
-- admin_delete_behaviour still let any admin delete an event, staff could
-- still set voided_at/voided_points/student_id from a copied request, and
-- anyone with /detention could cancel a detention or move its date. Its
-- three parts are applied here: delete on behaviour_events is ticked for smt
-- only; behaviour_event_release_guard() refuses withdrawing or moving an
-- event from the app; detention_cancel_guard() lets only a detention's status
-- change, and only SMT set it to cancelled (a fixed rule, not a tick).
--
-- Converted, with their starting ticks:
--   behaviour_events          view/add/edit: every role; delete: smt (319)
--   behaviour_event_students  view: every role (writing stays "whoever can
--                             edit the event", locked)
--   behaviour_photos          view/add: every role; delete: admin
--   behaviour_appeals         view all / edit: smt, houseparent,
--                             head_of_boarding, pastoral, admin (staff still
--                             see resolved appeals; students still appeal)
--   behaviour_categories      add/edit/delete: admin (everyone reads, locked)
--   detentions                view/edit: roles with /detention, and admin
--   attendance                view/add/edit: every role (the school's
--                             decision of 27 Sept 2026, now an ordinary tick)
--   attendance_codes          add/edit/delete: admin (everyone reads, locked)
--   planned_absences          view: every role (changes only through
--                             add/end_planned_absence(), locked)
--   register_alerts           view/edit: hr, school_office, admin
--   report_periods            view: every role; add/edit/delete: admin, smt,
--                             assessment_manager
--   report_checkers           all four: admin, smt (checkers still see their
--                             own rows)
--   report_subject_comments,  view/add/edit any comment: admin, smt (writers
--   report_pastoral_comments  keep their own drafts, checkers their period)
-- Actions the app has never been granted on a table are locked with the
-- reason, so the page doesn't offer a tick that would do nothing.
--
-- The one staff login with no role (networkofficer@) loses direct reads of
-- these tables; it opens no pages.

set local formwork.change_note = 'Principal (direct)';

-- ---------------------------------------------------------------- 319: guards

create or replace function public.behaviour_event_release_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- The review and edit functions run as their owner, and the SQL editor as
  -- postgres; only requests from the app arrive as 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.type = 'negative'
       and (new.visible_to_parents or new.protocol_reviewed_by is not null or new.protocol_reviewed_at is not null) then
      raise exception 'A negative behaviour event starts hidden from parents; it is released through the review.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.voided_at is not null or new.voided_points is not null then
      raise exception 'A behaviour event can''t be logged as withdrawn.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.visible_to_parents is distinct from old.visible_to_parents
     or new.protocol_reviewed_by is distinct from old.protocol_reviewed_by
     or new.protocol_reviewed_at is distinct from old.protocol_reviewed_at
     or new.type is distinct from old.type then
    raise exception 'Whether parents see a behaviour event is decided through the review at /behaviour/review, and an event''s type can''t be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Migration 319: removing an event is SMT's (delete), or an upheld appeal's.
  if new.voided_at is distinct from old.voided_at
     or new.voided_points is distinct from old.voided_points
     or new.student_id is distinct from old.student_id then
    raise exception 'A behaviour event can''t be withdrawn or moved to another student here. Only SMT can remove one.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.behaviour_event_release_guard() from public, anon, authenticated;

create or replace function public.detention_cancel_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- edit_behaviour_event() and void_event_on_upheld_appeal() cancel
  -- detentions automatically; they run as their owner, not 'authenticated'.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.student_id is distinct from old.student_id
     or new.behaviour_event_id is distinct from old.behaviour_event_id
     or new.detention_date is distinct from old.detention_date
     or new.is_demo is distinct from old.is_demo
     or new.created_at is distinct from old.created_at
     or new.student_notified_at is distinct from old.student_notified_at
     or new.reminded_at is distinct from old.reminded_at then
    raise exception 'Only a detention''s status can be changed.'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and not has_staff_role(array['smt']) then
    raise exception 'Only SMT can cancel a detention.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke execute on function public.detention_cancel_guard() from public, anon, authenticated;

drop trigger if exists detention_cancel_guard on public.detentions;
create trigger detention_cancel_guard
  before update on public.detentions
  for each row execute function public.detention_cancel_guard();

-- ---------------------------------------------------------------- locks

insert into public.role_ability_locks (table_name, action, reason) values
  ('behaviour_event_students', 'add', 'Whoever can edit the event: the teacher who logged it, pastoral, houseparents, head of boarding, SMT and the school office'),
  ('behaviour_event_students', 'edit', 'Whoever can edit the event: the teacher who logged it, pastoral, houseparents, head of boarding, SMT and the school office'),
  ('behaviour_event_students', 'delete', 'Whoever can edit the event: the teacher who logged it, pastoral, houseparents, head of boarding, SMT and the school office'),
  ('behaviour_photos', 'edit', 'Photos are added or removed, never edited'),
  ('behaviour_appeals', 'add', 'Only a student appeals their own negative event'),
  ('behaviour_appeals', 'delete', 'Appeals are never deleted'),
  ('behaviour_categories', 'view', 'Everyone signed in reads the behaviour categories'),
  ('detentions', 'add', 'Detentions are booked automatically by the detention rules'),
  ('detentions', 'delete', 'Detentions are never deleted; only SMT can cancel one (the principal, migration 319)'),
  ('attendance', 'delete', 'Register marks are never deleted from the app'),
  ('attendance_codes', 'view', 'Everyone signed in reads the attendance codes'),
  ('planned_absences', 'add', 'Only through Add planned absence, which checks the dates and code'),
  ('planned_absences', 'edit', 'Only through End planned absence'),
  ('planned_absences', 'delete', 'Planned absences are ended, never deleted'),
  ('register_alerts', 'add', 'Made automatically every 15 minutes for registers not taken'),
  ('register_alerts', 'delete', 'Alerts are resolved, never deleted'),
  ('report_subject_comments', 'delete', 'Report comments are never deleted'),
  ('report_pastoral_comments', 'delete', 'Report comments are never deleted');

-- ---------------------------------------------------------------- ticks: today's access

insert into public.role_ability_tables (table_name, stage) values
  ('behaviour_events', 2), ('behaviour_event_students', 2), ('behaviour_photos', 2),
  ('behaviour_appeals', 2), ('behaviour_categories', 2), ('detentions', 2),
  ('attendance', 2), ('attendance_codes', 2), ('planned_absences', 2), ('register_alerts', 2),
  ('report_periods', 2), ('report_checkers', 2),
  ('report_subject_comments', 2), ('report_pastoral_comments', 2);

-- Every role: what any member of staff could do (is_staff_or_admin()).
insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, t.action
from roles r
cross join (values
  ('behaviour_events', 'view'), ('behaviour_events', 'add'), ('behaviour_events', 'edit'),
  ('behaviour_event_students', 'view'),
  ('behaviour_photos', 'view'), ('behaviour_photos', 'add'),
  ('attendance', 'view'), ('attendance', 'add'), ('attendance', 'edit'),
  ('planned_absences', 'view'),
  ('report_periods', 'view')) t(table_name, action);

-- Named roles.
insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, a.action
from (values
  -- 319: deleting an event needs the smt role; admin alone is not enough.
  ('behaviour_events', 'smt', array['delete']),
  ('behaviour_photos', 'admin', array['delete']),
  ('behaviour_appeals', 'smt', array['view', 'edit']),
  ('behaviour_appeals', 'houseparent', array['view', 'edit']),
  ('behaviour_appeals', 'head_of_boarding', array['view', 'edit']),
  ('behaviour_appeals', 'pastoral', array['view', 'edit']),
  ('behaviour_appeals', 'admin', array['view', 'edit']),
  ('behaviour_categories', 'admin', array['add', 'edit', 'delete']),
  ('attendance_codes', 'admin', array['add', 'edit', 'delete']),
  ('register_alerts', 'hr', array['view', 'edit']),
  ('register_alerts', 'school_office', array['view', 'edit']),
  ('register_alerts', 'admin', array['view', 'edit']),
  ('report_periods', 'admin', array['add', 'edit', 'delete']),
  ('report_periods', 'smt', array['add', 'edit', 'delete']),
  ('report_periods', 'assessment_manager', array['add', 'edit', 'delete']),
  ('report_checkers', 'admin', array['view', 'add', 'edit', 'delete']),
  ('report_checkers', 'smt', array['view', 'add', 'edit', 'delete']),
  ('report_subject_comments', 'admin', array['view', 'add', 'edit']),
  ('report_subject_comments', 'smt', array['view', 'add', 'edit']),
  ('report_pastoral_comments', 'admin', array['view', 'add', 'edit']),
  ('report_pastoral_comments', 'smt', array['view', 'add', 'edit'])
) t(table_name, role_name, actions)
cross join lateral unnest(t.actions) a(action)
join roles r on r.role_name = t.role_name;

-- Detentions: whoever has the /detention page, and admin.
insert into public.role_abilities (role_name, table_name, action)
select distinct r.role_name, 'detentions', a.action
from (select role_name from role_permissions where resource_key = '/detention' union select 'admin') r
cross join (values ('view'), ('edit')) a(action);

-- ---------------------------------------------------------------- policies

-- Role-naming policies the ability policies replace.
drop policy if exists staff_read_behaviour on public.behaviour_events;
drop policy if exists staff_write_behaviour on public.behaviour_events;
drop policy if exists staff_update_behaviour on public.behaviour_events;
drop policy if exists admin_delete_behaviour on public.behaviour_events;
drop policy if exists smt_delete_behaviour on public.behaviour_events;
drop policy if exists staff_read_behaviour_event_students on public.behaviour_event_students;
drop policy if exists staff_read_behaviour_photos on public.behaviour_photos;
drop policy if exists staff_insert_behaviour_photos on public.behaviour_photos;
drop policy if exists admin_delete_behaviour_photos on public.behaviour_photos;
drop policy if exists pastoral_read_all_appeals on public.behaviour_appeals;
drop policy if exists pastoral_update_appeals on public.behaviour_appeals;
drop policy if exists admin_write_behaviour_categories on public.behaviour_categories;
drop policy if exists detention_page_read_detentions on public.detentions;
drop policy if exists detention_page_update_detentions on public.detentions;
drop policy if exists staff_read_attendance on public.attendance;
drop policy if exists staff_write_attendance on public.attendance;
drop policy if exists staff_update_attendance on public.attendance;
drop policy if exists admin_write_attendance_codes on public.attendance_codes;
drop policy if exists staff_read_planned_absences on public.planned_absences;
drop policy if exists hr_read_register_alerts on public.register_alerts;
drop policy if exists hr_update_register_alerts on public.register_alerts;
drop policy if exists report_periods_admin on public.report_periods;
drop policy if exists report_periods_staff_read on public.report_periods;
drop policy if exists report_checkers_admin on public.report_checkers;

-- Report comments: the writer's own and the period's checkers stay; the
-- "admin or SMT sees and changes any comment" part becomes the ticks.
alter policy subject_comments_select on public.report_subject_comments
  using ((staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid()))
         or exists (select 1 from report_checkers rc
                    where rc.report_period_id = report_subject_comments.report_period_id
                      and rc.staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())));
alter policy subject_comments_insert on public.report_subject_comments
  with check (staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid()));
alter policy subject_comments_update on public.report_subject_comments
  using (((staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())) and status = 'draft')
         or exists (select 1 from report_checkers rc
                    where rc.report_period_id = report_subject_comments.report_period_id
                      and rc.staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())));
alter policy pastoral_comments_select on public.report_pastoral_comments
  using ((staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid()))
         or exists (select 1 from report_checkers rc
                    where rc.report_period_id = report_pastoral_comments.report_period_id
                      and rc.staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())));
alter policy pastoral_comments_insert on public.report_pastoral_comments
  with check (staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid()));
alter policy pastoral_comments_update on public.report_pastoral_comments
  using (((staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())) and status = 'draft')
         or exists (select 1 from report_checkers rc
                    where rc.report_period_id = report_pastoral_comments.report_period_id
                      and rc.staff_id = (select profiles.staff_id from profiles where profiles.id = auth.uid())));

-- One ability policy per action that isn't locked.
do $$
declare
  t text;
begin
  foreach t in array array[
    'behaviour_events', 'behaviour_event_students', 'behaviour_photos', 'behaviour_appeals',
    'behaviour_categories', 'detentions', 'attendance', 'attendance_codes', 'planned_absences',
    'register_alerts', 'report_periods', 'report_checkers',
    'report_subject_comments', 'report_pastoral_comments']
  loop
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'view') then
      execute format('create policy ability_view on public.%I for select to authenticated using ((select has_ability(%L, ''view'')))', t, t);
    end if;
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'add') then
      execute format('create policy ability_add on public.%I for insert to authenticated with check ((select has_ability(%L, ''add'')))', t, t);
    end if;
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'edit') then
      execute format('create policy ability_edit on public.%I for update to authenticated using ((select has_ability(%L, ''edit''))) with check ((select has_ability(%L, ''edit'')))', t, t, t);
    end if;
    if not exists (select 1 from public.role_ability_locks l where l.table_name = t and l.action = 'delete') then
      execute format('create policy ability_delete on public.%I for delete to authenticated using ((select has_ability(%L, ''delete'')))', t, t);
    end if;
  end loop;
end;
$$;
