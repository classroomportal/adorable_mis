-- Migration 334: tickable role abilities, stage 6 (Timetable, calendar and
-- next year).
--
-- Why (the principal, 3 Oct 2026): a sixth stage after fees, for the tables
-- stages 1–5 didn't cover: classes, enrolments, lessons, curriculum blocks,
-- periods, bell times, mentor groups, staff commitments, terms, academic
-- years, calendar events and next year's plan_* tables (17 tables).
-- Generated from the live rules the same way as stages 4–5 (migrations
-- 332–333): writing becomes ticks with today's access (admin for the
-- timetable, SMT for the calendar and terms, the class allocators for
-- enrolments, next-year setup for the plan tables). Reading classes,
-- lessons, blocks, bell times, mentor groups, terms, years and the calendar
-- stays open to everyone signed in, padlocked, because students and parents
-- see timetables and the calendar. Periods are never changed from the app.
--
-- Untouched: the importers' and functions' own checks (add/set academic
-- year dates, confirm_mentor_structure(), the trigger refusing plan classes
-- before the mentor structure is confirmed), and the rule never to import
-- next year's Nova-T file without ?plan=.
--
-- Checked before and after for all 21 roles on every table and action: no
-- role gains or loses anything.

set local formwork.change_note = 'Principal (direct)';

-- ---------------------------------------------------------------- locks

insert into public.role_ability_locks (table_name, action, reason) values
  ('classes', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('student_class', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('timetable_slots', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('curriculum_blocks', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('periods', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('periods', 'add', 'Never done from the app'),
  ('periods', 'edit', 'Never done from the app'),
  ('periods', 'delete', 'Never done from the app'),
  ('bell_times', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('mentor_groups', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('terms', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('academic_years', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)'),
  ('calendar_events', 'view', 'Everyone signed in reads this (timetables, the calendar and term dates are shown to students and parents too)');

-- ---------------------------------------------------------------- ticks: today's access

insert into public.role_ability_tables (table_name, stage) values
  ('classes', 6), ('student_class', 6), ('timetable_slots', 6), ('curriculum_blocks', 6), ('periods', 6), ('bell_times', 6), ('mentor_groups', 6), ('staff_commitments', 6), ('terms', 6), ('academic_years', 6), ('calendar_events', 6), ('plan_classes', 6), ('plan_student_class', 6), ('plan_timetable_slots', 6), ('plan_curriculum_blocks', 6), ('plan_mentor_groups', 6), ('plan_mentor_assignments', 6);

insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, t.action
from (values
  ('academic_years', 'add', array['admin']),
  ('academic_years', 'delete', array['admin']),
  ('academic_years', 'edit', array['admin']),
  ('bell_times', 'add', array['admin']),
  ('bell_times', 'delete', array['admin']),
  ('bell_times', 'edit', array['admin']),
  ('calendar_events', 'add', array['admin', 'smt']),
  ('calendar_events', 'delete', array['admin', 'smt']),
  ('calendar_events', 'edit', array['admin', 'smt']),
  ('classes', 'add', array['admin']),
  ('classes', 'delete', array['admin']),
  ('classes', 'edit', array['admin']),
  ('curriculum_blocks', 'add', array['admin']),
  ('curriculum_blocks', 'delete', array['admin']),
  ('curriculum_blocks', 'edit', array['admin']),
  ('mentor_groups', 'add', array['admin']),
  ('mentor_groups', 'delete', array['admin']),
  ('mentor_groups', 'edit', array['admin']),
  ('plan_classes', 'add', array['admin', 'smt']),
  ('plan_classes', 'delete', array['admin', 'smt']),
  ('plan_classes', 'edit', array['admin', 'smt']),
  ('plan_classes', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('plan_curriculum_blocks', 'add', array['admin', 'smt']),
  ('plan_curriculum_blocks', 'delete', array['admin', 'smt']),
  ('plan_curriculum_blocks', 'edit', array['admin', 'smt']),
  ('plan_curriculum_blocks', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('plan_mentor_assignments', 'add', array['admin', 'smt']),
  ('plan_mentor_assignments', 'delete', array['admin', 'smt']),
  ('plan_mentor_assignments', 'edit', array['admin', 'smt']),
  ('plan_mentor_assignments', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('plan_mentor_groups', 'add', array['admin', 'smt']),
  ('plan_mentor_groups', 'delete', array['admin', 'smt']),
  ('plan_mentor_groups', 'edit', array['admin', 'smt']),
  ('plan_mentor_groups', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('plan_student_class', 'add', array['admin', 'head_of_department', 'pastoral', 'school_office', 'smt']),
  ('plan_student_class', 'delete', array['admin', 'head_of_department', 'pastoral', 'school_office', 'smt']),
  ('plan_student_class', 'edit', array['admin', 'head_of_department', 'pastoral', 'school_office', 'smt']),
  ('plan_student_class', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('plan_timetable_slots', 'add', array['admin', 'smt']),
  ('plan_timetable_slots', 'delete', array['admin', 'smt']),
  ('plan_timetable_slots', 'edit', array['admin', 'smt']),
  ('plan_timetable_slots', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('staff_commitments', 'add', array['admin']),
  ('staff_commitments', 'delete', array['admin']),
  ('staff_commitments', 'edit', array['admin']),
  ('staff_commitments', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('student_class', 'add', array['admin', 'head_of_department', 'pastoral', 'school_office']),
  ('student_class', 'delete', array['admin', 'head_of_department', 'pastoral', 'school_office']),
  ('student_class', 'edit', array['admin', 'head_of_department', 'pastoral', 'school_office']),
  ('terms', 'add', array['admin', 'smt']),
  ('terms', 'delete', array['admin']),
  ('terms', 'edit', array['admin', 'smt']),
  ('timetable_slots', 'add', array['admin']),
  ('timetable_slots', 'delete', array['admin']),
  ('timetable_slots', 'edit', array['admin'])
) t(table_name, action, roles)
cross join lateral unnest(t.roles) u(role_name)
join roles r on r.role_name = u.role_name;

-- ---------------------------------------------------------------- policies

-- Rules that only name roles or pages; replaced by the ability policies below.
drop policy if exists admin_write_classes on public.classes;
drop policy if exists admin_write_student_class on public.student_class;
drop policy if exists admin_write_timetable_slots on public.timetable_slots;
drop policy if exists admin_write_curriculum_blocks on public.curriculum_blocks;
drop policy if exists admin_write_bell_times on public.bell_times;
drop policy if exists admin_write_mentor_groups on public.mentor_groups;
drop policy if exists admin_write_commitments on public.staff_commitments;
drop policy if exists staff_read_commitments on public.staff_commitments;
drop policy if exists admin_write_terms on public.terms;
drop policy if exists smt_insert_terms on public.terms;
drop policy if exists smt_update_terms on public.terms;
drop policy if exists "Academic years writable by admin" on public.academic_years;
drop policy if exists smt_write_calendar_events on public.calendar_events;
drop policy if exists "Plan classes edited in next year setup" on public.plan_classes;
drop policy if exists "Plan classes readable by staff" on public.plan_classes;
drop policy if exists "Plan enrolments edited by allocators" on public.plan_student_class;
drop policy if exists "Plan enrolments readable by staff" on public.plan_student_class;
drop policy if exists "Plan lessons edited in next year setup" on public.plan_timetable_slots;
drop policy if exists "Plan lessons readable by staff" on public.plan_timetable_slots;
drop policy if exists "Plan blocks edited in next year setup" on public.plan_curriculum_blocks;
drop policy if exists "Plan blocks readable by staff" on public.plan_curriculum_blocks;
drop policy if exists "Plan mentor groups edited in next year setup" on public.plan_mentor_groups;
drop policy if exists "Plan mentor groups readable by staff" on public.plan_mentor_groups;
drop policy if exists "Plan mentor assignments edited in next year setup" on public.plan_mentor_assignments;
drop policy if exists "Plan mentor assignments readable by staff" on public.plan_mentor_assignments;

-- One ability policy per action that isn't padlocked.
do $$
declare
  t text;
begin
  foreach t in array array[
    'classes', 'student_class', 'timetable_slots', 'curriculum_blocks',
    'periods', 'bell_times', 'mentor_groups', 'staff_commitments',
    'terms', 'academic_years', 'calendar_events', 'plan_classes',
    'plan_student_class', 'plan_timetable_slots', 'plan_curriculum_blocks', 'plan_mentor_groups',
    'plan_mentor_assignments']
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
