-- Migration 332: tickable role abilities, stage 4 (Students & families,
-- Staff & HR, Tuckshop, The Other Half, Student groups, Admissions).
--
-- Why (the principal, 3 Oct 2026): stage 4 of docs/role-abilities-design.md,
-- the same way as stages 1–3 (migrations 329–331). 41 tables. For each
-- action on each table:
--   * if every rule that grants it only asks which role or page the person
--     holds, those rules are replaced by ability_<action>, and the roles they
--     let in become its ticks (today's access, unchanged);
--   * if a rule also looks at the record (an applicant must start as an
--     enquiry, only unpaid enquiries can be deleted, a new group can't be
--     built from a rule here), at who the person is (a group's own staff), or
--     lets parents or students in, the rules stay exactly as they are and the
--     action is padlocked, naming the rule;
--   * actions the app has never been granted are padlocked too.
-- Hand-set padlocks: adding a student (the principal: only the school
-- office, migrations 275 and 328, already padlocked) and editing a student,
-- which stays field by field on /admin/permissions.
--
-- Generated from the live rules on 3 Oct 2026 and checked before and after
-- for all 21 roles on every table and action: no role gains or loses
-- anything.

set local formwork.change_note = 'Principal (direct)';

-- ---------------------------------------------------------------- locks

insert into public.role_ability_locks (table_name, action, reason) values
  ('students', 'edit', 'Set field by field below (Student Core Data fields); admins edit every field'),
  ('families', 'view', 'Everyone signed in reads this list'),
  ('sports_houses', 'view', 'Everyone signed in reads this list'),
  ('boarding_houses', 'view', 'Everyone signed in reads this list'),
  ('staff', 'view', 'Everyone signed in reads the staff list'),
  ('tuckshop_items', 'view', 'Everyone signed in reads this list'),
  ('tuckshop_purchases', 'view', 'Tuckshop staff, the bursar and SMT, and each student and their parents for their own (fixed rule)'),
  ('tuckshop_purchase_items', 'view', 'Tuckshop staff, the bursar and SMT, and each student and their parents for their own (fixed rule)'),
  ('tuckshop_preorders', 'view', 'Tuckshop staff, the bursar and SMT, and each student and their parents for their own (fixed rule)'),
  ('tuckshop_preorders', 'add', 'Never done from the app'),
  ('tuckshop_preorders', 'edit', 'Never done from the app'),
  ('tuckshop_preorders', 'delete', 'Never done from the app'),
  ('tuckshop_preorder_items', 'view', 'Tuckshop staff, the bursar and SMT, and each student and their parents for their own (fixed rule)'),
  ('tuckshop_preorder_items', 'add', 'Never done from the app'),
  ('tuckshop_preorder_items', 'edit', 'Never done from the app'),
  ('tuckshop_preorder_items', 'delete', 'Never done from the app'),
  ('tuckshop_order_schedule', 'view', 'Everyone signed in reads this list'),
  ('tuckshop_special_sessions', 'view', 'Everyone signed in reads this list'),
  ('tuckshop_special_session_items', 'view', 'Everyone signed in reads this list'),
  ('tuckshop_handout_saves', 'add', 'Never done from the app'),
  ('tuckshop_handout_saves', 'edit', 'Never done from the app'),
  ('tuckshop_handout_saves', 'delete', 'Never done from the app'),
  ('other_half_activities', 'view', 'Everyone signed in reads this list'),
  ('other_half_activity_staff', 'view', 'Everyone signed in reads this list'),
  ('other_half_terms', 'view', 'Everyone signed in reads this list'),
  ('student_groups', 'add', 'SMT, pastoral and the school office add groups; groups built from a rule only through Build a group (fixed rule)'),
  ('student_groups', 'delete', 'Never done from the app'),
  ('student_group_members', 'edit', 'Never done from the app'),
  ('student_group_staff', 'edit', 'Never done from the app'),
  ('student_group_mark_sheets', 'add', 'The group''s own staff and those who manage groups (fixed rule)'),
  ('student_group_mark_sheets', 'edit', 'The group''s own staff and those who manage groups (fixed rule)'),
  ('student_group_mark_sheets', 'delete', 'The group''s own staff and those who manage groups (fixed rule)'),
  ('student_group_marks', 'view', 'The group''s own staff and those who manage groups; never students or parents (fixed rule)'),
  ('student_group_marks', 'add', 'The group''s own staff and those who manage groups (fixed rule)'),
  ('student_group_marks', 'edit', 'The group''s own staff and those who manage groups (fixed rule)'),
  ('student_group_marks', 'delete', 'The group''s own staff and those who manage groups (fixed rule)'),
  ('applicants', 'add', 'Admissions staff; a new applicant always starts as an enquiry (fixed rule)'),
  ('applicants', 'delete', 'Admissions staff delete unpaid enquiries only; admins any applicant (fixed rule)'),
  ('applicant_letters', 'add', 'Never done from the app'),
  ('applicant_letters', 'edit', 'Never done from the app'),
  ('applicant_letters', 'delete', 'Never done from the app'),
  ('admission_letter_templates', 'add', 'Never done from the app'),
  ('admission_letter_templates', 'delete', 'Never done from the app');

-- ---------------------------------------------------------------- ticks: today's access

insert into public.role_ability_tables (table_name, stage) values
  ('students', 4), ('parents', 4), ('student_parent', 4), ('families', 4), ('previous_schools', 4), ('student_documents', 4), ('sports_houses', 4), ('boarding_houses', 4), ('staff', 4), ('staff_hr_profiles', 4), ('staff_training', 4), ('staff_warnings', 4), ('staff_attendance_records', 4), ('tuckshop_items', 4), ('tuckshop_purchases', 4), ('tuckshop_purchase_items', 4), ('tuckshop_preorders', 4), ('tuckshop_preorder_items', 4), ('tuckshop_order_schedule', 4), ('tuckshop_special_sessions', 4), ('tuckshop_special_session_items', 4), ('tuckshop_handout_saves', 4), ('other_half_activities', 4), ('other_half_activity_staff', 4), ('other_half_choices', 4), ('other_half_terms', 4), ('student_groups', 4), ('student_group_members', 4), ('student_group_staff', 4), ('student_group_mark_sheets', 4), ('student_group_marks', 4), ('applicants', 4), ('applicant_contacts', 4), ('applicant_interviews', 4), ('applicant_letters', 4), ('admission_test_scores', 4), ('admission_cat4', 4), ('admission_sessions', 4), ('admission_papers', 4), ('admission_places', 4), ('admission_letter_templates', 4);

insert into public.role_abilities (role_name, table_name, action)
select r.role_name, t.table_name, t.action
from (values
  ('admission_cat4', 'add', array['admin', 'admissions', 'smt']),
  ('admission_cat4', 'delete', array['admin', 'admissions', 'smt']),
  ('admission_cat4', 'edit', array['admin', 'admissions', 'smt']),
  ('admission_cat4', 'view', array['admin', 'admissions', 'smt']),
  ('admission_letter_templates', 'edit', array['admin', 'admissions', 'smt']),
  ('admission_letter_templates', 'view', array['admin', 'admissions', 'smt']),
  ('admission_papers', 'add', array['admin', 'admissions', 'smt']),
  ('admission_papers', 'delete', array['admin', 'admissions', 'smt']),
  ('admission_papers', 'edit', array['admin', 'admissions', 'smt']),
  ('admission_papers', 'view', array['admin', 'admissions', 'smt']),
  ('admission_places', 'add', array['admin', 'smt']),
  ('admission_places', 'delete', array['admin', 'smt']),
  ('admission_places', 'edit', array['admin', 'smt']),
  ('admission_places', 'view', array['admin', 'admissions', 'smt']),
  ('admission_sessions', 'add', array['admin', 'admissions', 'smt']),
  ('admission_sessions', 'delete', array['admin', 'admissions', 'smt']),
  ('admission_sessions', 'edit', array['admin', 'admissions', 'smt']),
  ('admission_sessions', 'view', array['admin', 'admissions', 'smt']),
  ('admission_test_scores', 'add', array['admin', 'admissions', 'smt']),
  ('admission_test_scores', 'delete', array['admin', 'admissions', 'smt']),
  ('admission_test_scores', 'edit', array['admin', 'admissions', 'smt']),
  ('admission_test_scores', 'view', array['admin', 'admissions', 'smt']),
  ('applicant_contacts', 'add', array['admin', 'admissions', 'smt']),
  ('applicant_contacts', 'delete', array['admin', 'admissions', 'smt']),
  ('applicant_contacts', 'edit', array['admin', 'admissions', 'smt']),
  ('applicant_contacts', 'view', array['admin', 'admissions', 'smt']),
  ('applicant_interviews', 'add', array['admin', 'admissions', 'smt']),
  ('applicant_interviews', 'delete', array['admin', 'admissions', 'smt']),
  ('applicant_interviews', 'edit', array['admin', 'admissions', 'smt']),
  ('applicant_interviews', 'view', array['admin', 'admissions', 'smt']),
  ('applicant_letters', 'view', array['admin', 'admissions', 'smt']),
  ('applicants', 'edit', array['admin', 'admissions', 'smt']),
  ('applicants', 'view', array['admin', 'admissions', 'smt']),
  ('boarding_houses', 'add', array['admin']),
  ('boarding_houses', 'delete', array['admin']),
  ('boarding_houses', 'edit', array['admin']),
  ('families', 'add', array['admin']),
  ('families', 'delete', array['admin']),
  ('families', 'edit', array['admin']),
  ('other_half_activities', 'add', array['admin', 'other_half', 'smt']),
  ('other_half_activities', 'delete', array['admin', 'other_half', 'smt']),
  ('other_half_activities', 'edit', array['admin', 'other_half', 'smt']),
  ('other_half_activity_staff', 'add', array['admin', 'other_half', 'smt']),
  ('other_half_activity_staff', 'delete', array['admin', 'other_half', 'smt']),
  ('other_half_activity_staff', 'edit', array['admin', 'other_half', 'smt']),
  ('other_half_choices', 'add', array['admin', 'other_half', 'smt']),
  ('other_half_choices', 'delete', array['admin', 'other_half', 'smt']),
  ('other_half_choices', 'edit', array['admin', 'other_half', 'smt']),
  ('other_half_choices', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('other_half_terms', 'add', array['admin', 'other_half', 'smt']),
  ('other_half_terms', 'delete', array['admin', 'other_half', 'smt']),
  ('other_half_terms', 'edit', array['admin', 'other_half', 'smt']),
  ('parents', 'add', array['admin', 'school_office']),
  ('parents', 'delete', array['admin']),
  ('parents', 'edit', array['admin', 'school_office']),
  ('parents', 'view', array['admin', 'head_of_boarding', 'houseparent', 'pastoral', 'school_office', 'smt']),
  ('previous_schools', 'add', array['admin', 'admissions', 'smt']),
  ('previous_schools', 'delete', array['admin', 'admissions', 'smt']),
  ('previous_schools', 'edit', array['admin', 'admissions', 'smt']),
  ('previous_schools', 'view', array['admin', 'admissions', 'smt']),
  ('sports_houses', 'add', array['admin']),
  ('sports_houses', 'delete', array['admin']),
  ('sports_houses', 'edit', array['admin']),
  ('staff', 'add', array['admin', 'hr']),
  ('staff', 'delete', array['admin']),
  ('staff', 'edit', array['admin', 'hr']),
  ('staff_attendance_records', 'add', array['admin', 'hr']),
  ('staff_attendance_records', 'delete', array['admin', 'hr']),
  ('staff_attendance_records', 'edit', array['admin', 'hr']),
  ('staff_attendance_records', 'view', array['admin', 'hr', 'smt']),
  ('staff_hr_profiles', 'add', array['admin', 'hr']),
  ('staff_hr_profiles', 'delete', array['admin', 'hr']),
  ('staff_hr_profiles', 'edit', array['admin', 'hr']),
  ('staff_hr_profiles', 'view', array['admin', 'hr', 'smt']),
  ('staff_training', 'add', array['admin', 'hr']),
  ('staff_training', 'delete', array['admin', 'hr']),
  ('staff_training', 'edit', array['admin', 'hr']),
  ('staff_training', 'view', array['admin', 'hr', 'smt']),
  ('staff_warnings', 'add', array['admin', 'hr']),
  ('staff_warnings', 'delete', array['admin', 'hr']),
  ('staff_warnings', 'edit', array['admin', 'hr']),
  ('staff_warnings', 'view', array['admin', 'hr', 'smt']),
  ('student_documents', 'add', array['admin', 'assessment_manager', 'smt']),
  ('student_documents', 'delete', array['admin', 'assessment_manager', 'smt']),
  ('student_documents', 'edit', array['admin', 'assessment_manager', 'smt']),
  ('student_documents', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('student_group_mark_sheets', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('student_group_members', 'add', array['admin', 'pastoral', 'school_office', 'smt']),
  ('student_group_members', 'delete', array['admin', 'pastoral', 'school_office', 'smt']),
  ('student_group_members', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('student_group_staff', 'add', array['admin', 'pastoral', 'school_office', 'smt']),
  ('student_group_staff', 'delete', array['admin', 'pastoral', 'school_office', 'smt']),
  ('student_group_staff', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('student_groups', 'edit', array['admin', 'pastoral', 'school_office', 'smt']),
  ('student_groups', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('student_parent', 'add', array['admin', 'school_office']),
  ('student_parent', 'delete', array['admin', 'school_office']),
  ('student_parent', 'edit', array['admin', 'school_office']),
  ('student_parent', 'view', array['admin', 'head_of_boarding', 'houseparent', 'pastoral', 'school_office', 'smt']),
  ('students', 'delete', array['admin']),
  ('students', 'view', array['admin', 'admissions', 'assessment_manager', 'assessment_user', 'attendance_officer', 'bursar', 'college_secretary', 'head_of_boarding', 'head_of_department', 'houseparent', 'hr', 'mentor', 'nurse', 'other_half', 'pastoral', 'principal', 'school_office', 'smt', 'teacher', 'tuckshop', 'tuckshop_owner']),
  ('tuckshop_handout_saves', 'view', array['tuckshop', 'tuckshop_owner']),
  ('tuckshop_items', 'add', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_items', 'delete', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_items', 'edit', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_order_schedule', 'add', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_order_schedule', 'delete', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_order_schedule', 'edit', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_purchase_items', 'add', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_purchase_items', 'delete', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_purchase_items', 'edit', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_purchases', 'add', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_purchases', 'delete', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_purchases', 'edit', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_special_session_items', 'add', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_special_session_items', 'delete', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_special_session_items', 'edit', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_special_sessions', 'add', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_special_sessions', 'delete', array['admin', 'bursar', 'tuckshop']),
  ('tuckshop_special_sessions', 'edit', array['admin', 'bursar', 'tuckshop'])
) t(table_name, action, roles)
cross join lateral unnest(t.roles) u(role_name)
join roles r on r.role_name = u.role_name;

-- ---------------------------------------------------------------- policies

-- Rules that only name roles or pages; replaced by the ability policies below.
drop policy if exists admin_delete_students on public.students;
drop policy if exists admin_read_students on public.students;
drop policy if exists staff_read_students on public.students;
drop policy if exists admin_write_parents on public.parents;
drop policy if exists read_parents_pastoral on public.parents;
drop policy if exists school_office_insert_parents on public.parents;
drop policy if exists school_office_read_parents on public.parents;
drop policy if exists school_office_update_parents on public.parents;
drop policy if exists admin_write_student_parent on public.student_parent;
drop policy if exists read_student_parent_pastoral on public.student_parent;
drop policy if exists school_office_write_student_parent on public.student_parent;
drop policy if exists admin_write_families on public.families;
drop policy if exists "Previous schools added by admissions" on public.previous_schools;
drop policy if exists "Previous schools edited on the schools page" on public.previous_schools;
drop policy if exists "Previous schools readable by admissions" on public.previous_schools;
drop policy if exists "Unused previous schools deleted on the schools page" on public.previous_schools;
drop policy if exists staff_manage_student_documents on public.student_documents;
drop policy if exists staff_read_student_documents on public.student_documents;
drop policy if exists admin_write_sports_houses on public.sports_houses;
drop policy if exists admin_write_boarding_houses on public.boarding_houses;
drop policy if exists admin_write_staff on public.staff;
drop policy if exists hr_insert_staff on public.staff;
drop policy if exists hr_update_staff on public.staff;
drop policy if exists hr_read_staff_hr_profiles on public.staff_hr_profiles;
drop policy if exists hr_write_staff_hr_profiles on public.staff_hr_profiles;
drop policy if exists hr_read_staff_training on public.staff_training;
drop policy if exists hr_write_staff_training on public.staff_training;
drop policy if exists hr_read_staff_warnings on public.staff_warnings;
drop policy if exists hr_write_staff_warnings on public.staff_warnings;
drop policy if exists hr_read_staff_attendance_records on public.staff_attendance_records;
drop policy if exists hr_write_staff_attendance_records on public.staff_attendance_records;
drop policy if exists "Tuckshop items writable by tuckshop staff" on public.tuckshop_items;
drop policy if exists "Tuckshop purchases writable by tuckshop staff" on public.tuckshop_purchases;
drop policy if exists "Tuckshop purchase items writable by tuckshop staff" on public.tuckshop_purchase_items;
drop policy if exists "Tuckshop schedule writable by tuckshop staff" on public.tuckshop_order_schedule;
drop policy if exists "Special tuckshop sessions writable by tuckshop staff" on public.tuckshop_special_sessions;
drop policy if exists "Special tuckshop session items writable by tuckshop staff" on public.tuckshop_special_session_items;
drop policy if exists "Tuckshop staff read hand-out saves" on public.tuckshop_handout_saves;
drop policy if exists manage_other_half_activities on public.other_half_activities;
drop policy if exists manage_other_half_activity_staff on public.other_half_activity_staff;
drop policy if exists manage_other_half_choices on public.other_half_choices;
drop policy if exists staff_read_other_half_choices on public.other_half_choices;
drop policy if exists manage_other_half_terms on public.other_half_terms;
drop policy if exists student_groups_manage_update on public.student_groups;
drop policy if exists student_groups_staff_read on public.student_groups;
drop policy if exists student_group_members_manage_delete on public.student_group_members;
drop policy if exists student_group_members_manage_insert on public.student_group_members;
drop policy if exists student_group_members_staff_read on public.student_group_members;
drop policy if exists student_group_staff_manage_delete on public.student_group_staff;
drop policy if exists student_group_staff_manage_insert on public.student_group_staff;
drop policy if exists student_group_staff_staff_read on public.student_group_staff;
drop policy if exists group_mark_sheets_staff_read on public.student_group_mark_sheets;
drop policy if exists "Applicants edited by admissions" on public.applicants;
drop policy if exists "Applicants readable by admissions" on public.applicants;
drop policy if exists "Applicant contacts readable by admissions" on public.applicant_contacts;
drop policy if exists "Applicant contacts written by admissions" on public.applicant_contacts;
drop policy if exists "Applicant interviews readable and written by admissions" on public.applicant_interviews;
drop policy if exists "Applicant letters readable by admissions" on public.applicant_letters;
drop policy if exists "Admission scores readable and written by admissions" on public.admission_test_scores;
drop policy if exists "Admission CAT4 readable and written by admissions" on public.admission_cat4;
drop policy if exists "Admission sessions readable by admissions" on public.admission_sessions;
drop policy if exists "Admission sessions written on the test days page" on public.admission_sessions;
drop policy if exists "Admission papers readable by admissions" on public.admission_papers;
drop policy if exists "Admission papers written on the papers page" on public.admission_papers;
drop policy if exists admission_places_delete on public.admission_places;
drop policy if exists admission_places_insert on public.admission_places;
drop policy if exists admission_places_read on public.admission_places;
drop policy if exists admission_places_update on public.admission_places;
drop policy if exists "Letter templates edited on the letters page" on public.admission_letter_templates;
drop policy if exists "Letter templates readable by admissions" on public.admission_letter_templates;

-- One ability policy per action that isn't padlocked.
do $$
declare
  t text;
begin
  foreach t in array array[
    'students', 'parents', 'student_parent', 'families', 'previous_schools',
    'student_documents', 'sports_houses', 'boarding_houses', 'staff', 'staff_hr_profiles',
    'staff_training', 'staff_warnings', 'staff_attendance_records', 'tuckshop_items', 'tuckshop_purchases',
    'tuckshop_purchase_items', 'tuckshop_preorders', 'tuckshop_preorder_items', 'tuckshop_order_schedule', 'tuckshop_special_sessions',
    'tuckshop_special_session_items', 'tuckshop_handout_saves', 'other_half_activities', 'other_half_activity_staff', 'other_half_choices',
    'other_half_terms', 'student_groups', 'student_group_members', 'student_group_staff', 'student_group_mark_sheets',
    'student_group_marks', 'applicants', 'applicant_contacts', 'applicant_interviews', 'applicant_letters',
    'admission_test_scores', 'admission_cat4', 'admission_sessions', 'admission_papers', 'admission_places',
    'admission_letter_templates']
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
