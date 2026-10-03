-- Migration 331: tickable role abilities, stage 3 (Results & assessment,
-- Homework).
--
-- Why (the principal, 3 Oct 2026): stage 3 of docs/role-abilities-design.md.
-- As in stages 1 and 2 (migrations 329–330), each converted table's
-- role-naming policies become ability_view / add / edit / delete reading
-- the ticks in role_abilities, and the ticks start as today's access. Rules
-- tied to particular records stay as they are:
--   * results: a teacher enters and edits scores for students they teach,
--     a Head of Department for their department's subjects
--     (teacher_*_own_class_results, hod_*_department_results), and deleting
--     a score stays can_delete_result() (migration 236), locked;
--   * homework, its marks, files and done ticks: the class's teachers, its
--     Head of Department and admins write (can_set_homework()), marks are
--     read by can_view_homework_marks() and the student's current subject
--     teacher, students read only their own: all locked. Parents never see
--     homework marks (the principal's decision, padlocked);
--   * students' and parents' own results, targets, transcripts, CAT4 and
--     NGRT stay as they are.
-- Grade logging (grade_history triggers) is untouched.
--
-- Converted, with their starting ticks:
--   results              view: every role; add/edit any score: admin,
--                        assessment_manager, assessment_user
--   target_grades        view: every role; add/edit: admin,
--                        assessment_manager, assessment_user; delete: admin,
--                        assessment_manager
--   transcript_grades    view: every role; add/edit/delete: admin,
--                        assessment_manager
--   cat4_results,        view: every role; add/edit/delete: admin,
--   ngrt_results         assessment_manager
--   reading_age_tests    view: every role; add/edit/delete: roles with
--                        /reading-ages/record, and admin
--   subjects, departments, grade_scale
--                        add/edit/delete: admin (everyone reads, locked)
--   subject_aliases,     add/edit/delete: every role (the school's decision
--   subject_key_stages   of 27 Sept 2026, now an ordinary tick; the
--                        principal, 3 Oct 2026); everyone reads, locked
--   homework             view: every role (writing locked, above)
--   homework_classes     add/delete (switch a class on or off): admin;
--                        everyone reads, locked
--   homework_schemes,    add/edit: roles with /admin/lookups, and admin;
--   homework_scheme_values  everyone reads, locked
-- Actions the app has never been granted are locked with the reason.

set local formwork.change_note = 'Principal (direct)';

-- ---------------------------------------------------------------- locks

insert into public.role_ability_locks (table_name, action, reason) values
  ('results', 'delete', 'The class teacher, the Head of Department for their department, assessment managers and admins (fixed rule, migration 236)'),
  ('subjects', 'view', 'Everyone signed in reads the subjects'),
  ('departments', 'view', 'Everyone signed in reads the departments'),
  ('grade_scale', 'view', 'Everyone signed in reads the grade scale'),
  ('subject_aliases', 'view', 'Everyone signed in reads the subject aliases'),
  ('subject_key_stages', 'view', 'Everyone signed in reads the subject key stages'),
  ('homework', 'add', 'Whoever teaches the class (class or lesson teacher), its Head of Department and admins, on switched-on classes (fixed rule)'),
  ('homework', 'edit', 'Whoever teaches the class (class or lesson teacher), its Head of Department and admins, on switched-on classes (fixed rule)'),
  ('homework', 'delete', 'Whoever teaches the class (class or lesson teacher), its Head of Department and admins, on switched-on classes (fixed rule)'),
  ('homework_marks', 'view', 'The class''s teachers, its Head of Department, SMT, and the student''s current subject teacher; never parents (the principal)'),
  ('homework_marks', 'add', 'Whoever teaches the class, its Head of Department and admins (fixed rule)'),
  ('homework_marks', 'edit', 'Whoever teaches the class, its Head of Department and admins (fixed rule)'),
  ('homework_marks', 'delete', 'Whoever teaches the class, its Head of Department and admins (fixed rule)'),
  ('homework_attachments', 'view', 'Whoever can see the homework'),
  ('homework_attachments', 'add', 'Whoever teaches the class, its Head of Department and admins (fixed rule)'),
  ('homework_attachments', 'edit', 'Files and links are added or removed, never edited'),
  ('homework_attachments', 'delete', 'Whoever teaches the class, its Head of Department and admins (fixed rule)'),
  ('homework_done', 'view', 'The student, and those who see the class''s marks'),
  ('homework_done', 'add', 'Students tick their own homework'),
  ('homework_done', 'edit', 'Ticks are added or removed, never edited'),
  ('homework_done', 'delete', 'Students untick their own homework'),
  ('homework_classes', 'view', 'Everyone signed in reads which classes use homework'),
  ('homework_classes', 'edit', 'A class is switched on or off, never edited'),
  ('homework_schemes', 'view', 'Everyone signed in reads the marking schemes'),
  ('homework_schemes', 'delete', 'Marking schemes are never deleted'),
  ('homework_scheme_values', 'view', 'Everyone signed in reads the marking scheme values'),
  ('homework_scheme_values', 'delete', 'Marking scheme values are never deleted');

-- ---------------------------------------------------------------- ticks: today's access

insert into public.role_ability_tables (table_name, stage) values
  ('results', 3), ('target_grades', 3), ('transcript_grades', 3),
  ('cat4_results', 3), ('ngrt_results', 3), ('reading_age_tests', 3),
  ('subjects', 3), ('departments', 3), ('grade_scale', 3),
  ('subject_aliases', 3), ('subject_key_stages', 3),
  ('homework', 3), ('homework_classes', 3), ('homework_schemes', 3), ('homework_scheme_values', 3);

-- Every role: what any member of staff could do (is_staff_or_admin()).
insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, t.action
from roles r
cross join (values
  ('results', 'view'), ('target_grades', 'view'), ('transcript_grades', 'view'),
  ('cat4_results', 'view'), ('ngrt_results', 'view'), ('reading_age_tests', 'view'),
  ('subject_aliases', 'add'), ('subject_aliases', 'edit'), ('subject_aliases', 'delete'),
  ('subject_key_stages', 'add'), ('subject_key_stages', 'edit'), ('subject_key_stages', 'delete'),
  ('homework', 'view')) t(table_name, action);

-- Named roles.
insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, a.action
from (values
  ('results', 'admin', array['add', 'edit']),
  ('results', 'assessment_manager', array['add', 'edit']),
  ('results', 'assessment_user', array['add', 'edit']),
  ('target_grades', 'admin', array['add', 'edit', 'delete']),
  ('target_grades', 'assessment_manager', array['add', 'edit', 'delete']),
  ('target_grades', 'assessment_user', array['add', 'edit']),
  ('transcript_grades', 'admin', array['add', 'edit', 'delete']),
  ('transcript_grades', 'assessment_manager', array['add', 'edit', 'delete']),
  ('cat4_results', 'admin', array['add', 'edit', 'delete']),
  ('cat4_results', 'assessment_manager', array['add', 'edit', 'delete']),
  ('ngrt_results', 'admin', array['add', 'edit', 'delete']),
  ('ngrt_results', 'assessment_manager', array['add', 'edit', 'delete']),
  ('subjects', 'admin', array['add', 'edit', 'delete']),
  ('departments', 'admin', array['add', 'edit', 'delete']),
  ('grade_scale', 'admin', array['add', 'edit', 'delete']),
  ('homework_classes', 'admin', array['add', 'delete'])
) t(table_name, role_name, actions)
cross join lateral unnest(t.actions) a(action)
join roles r on r.role_name = t.role_name;

-- Reading tests: whoever has /reading-ages/record, and admin.
insert into public.role_abilities (role_name, table_name, action)
select distinct r.role_name, 'reading_age_tests', a.action
from (select role_name from role_permissions where resource_key = '/reading-ages/record' union select 'admin') r
cross join (values ('add'), ('edit'), ('delete')) a(action);

-- Marking schemes: whoever has /admin/lookups, and admin.
insert into public.role_abilities (role_name, table_name, action)
select distinct r.role_name, t.table_name, a.action
from (select role_name from role_permissions where resource_key = '/admin/lookups' union select 'admin') r
cross join (values ('homework_schemes'), ('homework_scheme_values')) t(table_name)
cross join (values ('add'), ('edit')) a(action);

-- ---------------------------------------------------------------- policies

-- Role-naming policies the ability policies replace. Policies tied to
-- particular records (own class, department, students, parents) stay.
drop policy if exists staff_read_results on public.results;
drop policy if exists assessment_write_results on public.results;
drop policy if exists assessment_update_results on public.results;
drop policy if exists assessment_user_insert_results on public.results;
drop policy if exists assessment_user_update_results on public.results;
drop policy if exists read_all_target_grades on public.target_grades;
drop policy if exists assessment_insert_target_grades on public.target_grades;
drop policy if exists assessment_update_target_grades on public.target_grades;
drop policy if exists assessment_delete_target_grades on public.target_grades;
drop policy if exists assessment_user_insert_target_grades on public.target_grades;
drop policy if exists assessment_user_update_target_grades on public.target_grades;
drop policy if exists read_all_transcript_grades on public.transcript_grades;
drop policy if exists assessment_insert_transcript_grades on public.transcript_grades;
drop policy if exists assessment_update_transcript_grades on public.transcript_grades;
drop policy if exists assessment_delete_transcript_grades on public.transcript_grades;
drop policy if exists staff_read_cat4 on public.cat4_results;
drop policy if exists admin_write_cat4 on public.cat4_results;
drop policy if exists assessment_manager_write_cat4 on public.cat4_results;
drop policy if exists staff_read_ngrt on public.ngrt_results;
drop policy if exists admin_write_ngrt on public.ngrt_results;
drop policy if exists assessment_manager_write_ngrt on public.ngrt_results;
drop policy if exists staff_read_reading_age_tests on public.reading_age_tests;
drop policy if exists record_reading_age_tests on public.reading_age_tests;
drop policy if exists admin_write_subjects on public.subjects;
drop policy if exists "departments editable by admin" on public.departments;
drop policy if exists admin_write_grade_scale on public.grade_scale;
drop policy if exists "staff manage subject aliases" on public.subject_aliases;
drop policy if exists "staff manage subject key stages" on public.subject_key_stages;
drop policy if exists "Homework readable by staff" on public.homework;
drop policy if exists "Homework classes switched on by admins" on public.homework_classes;
drop policy if exists "Homework classes switched off by admins" on public.homework_classes;
drop policy if exists "Homework schemes added on Lookups" on public.homework_schemes;
drop policy if exists "Homework schemes edited on Lookups" on public.homework_schemes;
drop policy if exists "Homework scheme values added on Lookups" on public.homework_scheme_values;
drop policy if exists "Homework scheme values edited on Lookups" on public.homework_scheme_values;

-- One ability policy per action that isn't locked.
do $$
declare
  t text;
begin
  foreach t in array array[
    'results', 'target_grades', 'transcript_grades', 'cat4_results', 'ngrt_results',
    'reading_age_tests', 'subjects', 'departments', 'grade_scale',
    'subject_aliases', 'subject_key_stages',
    'homework', 'homework_classes', 'homework_schemes', 'homework_scheme_values']
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
