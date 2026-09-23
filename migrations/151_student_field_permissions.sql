-- Migration 151: per-role Read/Edit access to each student Core Data field,
-- set by admin at /admin/permissions.
--
-- Until now editing a student's core data was all-or-nothing: admin and
-- school_office could change every column (RLS policies admin_write_students
-- and school_office_update_students), everyone else none. The school wants to
-- choose field by field which roles may change what — e.g. let boarding staff
-- set boarding house without also being able to change a name or status.
--
-- A row in student_field_permissions means "this role may edit this field";
-- no row means read-only. There is no "hidden": every staff role can already
-- read the whole students row, and many pages rely on that, so hiding a field
-- in one page would promise a protection that doesn't exist.
--
-- Enforced here rather than in the page:
--   * field_editors_update_students lets any role with at least one grant
--     reach UPDATE on students at all;
--   * trg_a_check_student_field_edit then rejects a change to any core field
--     the caller's roles can't edit. It is named to sort before the other
--     BEFORE triggers so it sees the caller's own change, not status set by
--     trg_auto_set_student_status from a passed leaving date or
--     mentor_group_id set by trg_sync_mentor_group_from_form_class.
--   * Changes to columns outside the core list (fees, ethnicity/FSM, family
--     links, ...) stay with admin and school_office, as before, so a single
--     field grant never opens up the rest of the row.
-- Admin always passes. So do updates made from inside SECURITY DEFINER
-- functions and cron jobs (current_user isn't "authenticated" there): those
-- are server logic with their own checks, not a user editing a field.
--
-- school_office is granted every field so nothing changes for them until an
-- admin narrows it.

create or replace function student_core_fields()
returns text[]
language sql
immutable
as $$
  select array['first_name', 'middle_name', 'last_name', 'preferred_name', 'legal_first_name', 'legal_last_name', 'upn', 'student_email', 'dob', 'year_group', 'form_class', 'admission_date', 'admitted_letter_date', 'gender', 'nationality', 'state_of_origin', 'lga', 'home_town', 'religion', 'boarding_house', 'boarding_room_number', 'sports_house', 'restaurant', 'national_identity_number', 'neco_exam_number', 'utme_pin', 'utme_profile_code', 'address_line1', 'address_line2', 'city', 'postcode', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'medical_notes', 'leaving_date', 'status', 'photo_base64']::text[];
$$;

create table if not exists student_field_permissions (
  role_name text not null references roles(role_name) on delete cascade,
  field_name text not null check (field_name = any (student_core_fields())),
  primary key (role_name, field_name)
);

alter table student_field_permissions enable row level security;

-- Explicit Data API grant: from 30 Oct 2026 Supabase no longer grants new
-- public tables to the API roles automatically. RLS still decides the rows.
grant select, insert, update, delete on student_field_permissions to authenticated;

drop policy if exists "student_field_permissions readable by all authenticated" on student_field_permissions;
create policy "student_field_permissions readable by all authenticated" on student_field_permissions
  for select using (auth.role() = 'authenticated');

drop policy if exists "student_field_permissions editable by admin" on student_field_permissions;
create policy "student_field_permissions editable by admin" on student_field_permissions
  for all using (is_admin()) with check (is_admin());

-- The fields the signed-in user may edit, through any of their staff roles.
create or replace function my_editable_student_fields()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select case when is_admin() then student_core_fields()
  else coalesce((
    select array_agg(distinct sfp.field_name)
    from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    join student_field_permissions sfp on sfp.role_name = sr.role_name
    where p.id = auth.uid()
  ), '{}') end;
$$;

create or replace function can_edit_any_student_field()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select cardinality(my_editable_student_fields()) > 0;
$$;

drop policy if exists field_editors_update_students on students;
create policy field_editors_update_students on students
  for update using (can_edit_any_student_field()) with check (can_edit_any_student_field());

create or replace function check_student_field_edit()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  allowed text[];
  blocked text[];
begin
  if current_user <> 'authenticated' or is_admin() then
    return new;
  end if;

  allowed := my_editable_student_fields();
  select array_agg(f order by f) into blocked
  from unnest(student_core_fields()) f
  where (n -> f) is distinct from (o -> f)
    and not (f = any (allowed));

  if blocked is not null then
    raise exception 'You do not have permission to change: %. Ask an admin to grant it at /admin/permissions.',
      array_to_string(blocked, ', ')
      using errcode = 'insufficient_privilege';
  end if;

  if not user_has_staff_role(array['school_office'])
     and (n - student_core_fields()) is distinct from (o - student_core_fields()) then
    raise exception 'You can only change the student fields your role has been given at /admin/permissions.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_a_check_student_field_edit on students;
create trigger trg_a_check_student_field_edit
  before update on students
  for each row execute function check_student_field_edit();

insert into student_field_permissions (role_name, field_name)
select 'school_office', f from unnest(student_core_fields()) f
on conflict do nothing;
