-- Migration 284: student groups, stage 1 (groups, members, the staff who run
-- them, and messages to a group).
--
-- Why (the principal, 30 Sept 2026): the school needs groups of students for
-- activities (a trip, a club, the prefects), for recording marks, for writing
-- to parents, and lists the system builds from behaviour or progress. The
-- design and the principal's decisions are in docs/student-groups-design.md.
-- This migration is stage 1; rule-built groups, mark sheets and the portal
-- views come later.
--
-- Now:
--   * student_groups: name, description, kind (a label: activity, marks,
--     intervention, leadership, other), visibility (staff, students, or
--     students and parents; used by the portals from stage 4) and the
--     academic year, stamped from the current year. A group is archived, never
--     deleted, so its history stays readable. The rule columns are for stage
--     2: a group built from a rule is always staff-only (the principal's
--     decision), enforced here already.
--   * student_group_members: the students in a group. Only active students
--     can be added. A student who later leaves stays listed and simply drops
--     out of messages (message_group_students() only takes active students).
--   * student_group_staff: the staff who run a group (trip leader, coach).
--     They see it like any member of staff; they can't change who is in it.
--   * Who can create, edit, archive and change members or staff: smt,
--     pastoral, school_office and admin (can_manage_student_groups(), the
--     principal's decision). All staff can read groups and their members (the
--     principal agreed the proposal: like classes today). Students and parents
--     get nothing yet.
--   * Every change is logged permanently in change_history under a new area,
--     'groups'. "Who did it" columns are stamped from auth.uid().
--   * Messages: 'student_group' is a new student-group target in
--     /comms/compose, so a message can go to the students, parents or both of
--     one or more groups, exactly like a year group or a class (migration 277).
--     Archived groups aren't offered and can't be messaged.
--   * /groups is added under Administration and granted to smt, pastoral,
--     school_office (who manage groups) and teacher (who can look them up).

-- 1. Who manages groups ------------------------------------------------------------

create or replace function public.can_manage_student_groups()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select user_has_staff_role(array['smt', 'pastoral', 'school_office']);
$$;

revoke execute on function public.can_manage_student_groups() from public, anon;
grant execute on function public.can_manage_student_groups() to authenticated;

-- 2. Groups -------------------------------------------------------------------------

create table if not exists public.student_groups (
  group_id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  kind text not null default 'activity'
    check (kind in ('activity', 'marks', 'intervention', 'leadership', 'other')),
  visibility text not null default 'staff'
    check (visibility in ('staff', 'students', 'students_and_parents')),
  academic_year_id integer references public.academic_years(academic_year_id),
  -- Stage 2: the rule a group was built from, its settings and the date.
  rule_type text,
  rule_settings jsonb,
  built_on date,
  archived_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A list built from behaviour or progress is never shown to students or parents.
  constraint student_groups_rule_staff_only check (rule_type is null or visibility = 'staff')
);

comment on table public.student_groups is
  'Groups of students made by smt, pastoral or the school office (migration 284). Archived, never deleted.';

create or replace function public.student_groups_prepare()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    new.academic_year_id := (select academic_year_id from academic_years where status = 'current' order by start_date desc limit 1);
    new.created_at := now();
  else
    new.academic_year_id := old.academic_year_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- What a group was built from is fixed once it is made.
    new.rule_type := old.rule_type;
    new.rule_settings := old.rule_settings;
    new.built_on := old.built_on;
  end if;
  new.name := btrim(new.name);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_student_groups_prepare on public.student_groups;
create trigger trg_student_groups_prepare before insert or update on public.student_groups
  for each row execute function public.student_groups_prepare();

drop trigger if exists trg_stamp_created_by on public.student_groups;
create trigger trg_stamp_created_by before insert on public.student_groups
  for each row execute function public.stamp_actor('created_by');
drop trigger if exists trg_stamp_updated_by on public.student_groups;
create trigger trg_stamp_updated_by before insert or update on public.student_groups
  for each row execute function public.stamp_actor('updated_by');

alter table public.student_groups enable row level security;
grant select, insert, update on public.student_groups to authenticated;

drop policy if exists student_groups_staff_read on public.student_groups;
create policy student_groups_staff_read on public.student_groups
  for select using (is_staff_or_admin());

drop policy if exists student_groups_manage_insert on public.student_groups;
create policy student_groups_manage_insert on public.student_groups
  for insert with check (can_manage_student_groups() and archived_at is null);

drop policy if exists student_groups_manage_update on public.student_groups;
create policy student_groups_manage_update on public.student_groups
  for update using (can_manage_student_groups()) with check (can_manage_student_groups());

-- 3. Members --------------------------------------------------------------------------

create table if not exists public.student_group_members (
  group_id bigint not null references public.student_groups(group_id),
  student_id integer not null references public.students(student_id),
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (group_id, student_id)
);

create index if not exists student_group_members_student_idx on public.student_group_members (student_id);

create or replace function public.student_group_members_check()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from students s where s.student_id = new.student_id and s.status = 'active') then
    raise exception 'Only current students can be added to a group.';
  end if;
  if exists (select 1 from student_groups g where g.group_id = new.group_id and g.archived_at is not null) then
    raise exception 'This group is archived.';
  end if;
  new.added_at := now();
  return new;
end;
$$;

drop trigger if exists trg_student_group_members_check on public.student_group_members;
create trigger trg_student_group_members_check before insert on public.student_group_members
  for each row execute function public.student_group_members_check();

drop trigger if exists trg_stamp_added_by on public.student_group_members;
create trigger trg_stamp_added_by before insert on public.student_group_members
  for each row execute function public.stamp_actor('added_by');

alter table public.student_group_members enable row level security;
grant select, insert, delete on public.student_group_members to authenticated;

drop policy if exists student_group_members_staff_read on public.student_group_members;
create policy student_group_members_staff_read on public.student_group_members
  for select using (is_staff_or_admin());

drop policy if exists student_group_members_manage_insert on public.student_group_members;
create policy student_group_members_manage_insert on public.student_group_members
  for insert with check (can_manage_student_groups());

drop policy if exists student_group_members_manage_delete on public.student_group_members;
create policy student_group_members_manage_delete on public.student_group_members
  for delete using (can_manage_student_groups());

-- 4. The staff who run a group -----------------------------------------------------

create table if not exists public.student_group_staff (
  group_id bigint not null references public.student_groups(group_id),
  staff_id integer not null references public.staff(staff_id),
  added_by uuid,
  added_at timestamptz not null default now(),
  primary key (group_id, staff_id)
);

create index if not exists student_group_staff_staff_idx on public.student_group_staff (staff_id);

drop trigger if exists trg_stamp_added_by on public.student_group_staff;
create trigger trg_stamp_added_by before insert on public.student_group_staff
  for each row execute function public.stamp_actor('added_by');

alter table public.student_group_staff enable row level security;
grant select, insert, delete on public.student_group_staff to authenticated;

drop policy if exists student_group_staff_staff_read on public.student_group_staff;
create policy student_group_staff_staff_read on public.student_group_staff
  for select using (is_staff_or_admin());

drop policy if exists student_group_staff_manage_insert on public.student_group_staff;
create policy student_group_staff_manage_insert on public.student_group_staff
  for insert with check (can_manage_student_groups());

drop policy if exists student_group_staff_manage_delete on public.student_group_staff;
create policy student_group_staff_manage_delete on public.student_group_staff
  for delete using (can_manage_student_groups());

-- 5. Change history -------------------------------------------------------------------

alter table public.change_history drop constraint if exists change_history_area_check;
alter table public.change_history add constraint change_history_area_check
  check (area in ('registers', 'fees', 'behaviour', 'access', 'parent_links', 'email', 'admissions', 'groups'));

drop trigger if exists trg_log_change on public.student_groups;
create trigger trg_log_change after insert or update or delete on public.student_groups
  for each row execute function public.log_change('groups', 'group_id');

drop trigger if exists trg_log_change on public.student_group_members;
create trigger trg_log_change after insert or update or delete on public.student_group_members
  for each row execute function public.log_change('groups', 'group_id,student_id');

drop trigger if exists trg_log_change on public.student_group_staff;
create trigger trg_log_change after insert or update or delete on public.student_group_staff
  for each row execute function public.log_change('groups', 'group_id,staff_id');

-- 6. Messages to a group -----------------------------------------------------------------

create or replace function public.message_group_students(p_target_type text, p_values text[])
returns table(student_id integer)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select s.student_id from students s
  where s.status = 'active'
    and (
      p_target_type in ('all_students', 'all_parents')
      or (p_target_type = 'year_group' and s.year_group::text = any(p_values))
      or (p_target_type = 'form_class' and s.form_class = any(p_values))
      or (p_target_type = 'boarding_house' and s.boarding_house = any(p_values))
      or (p_target_type = 'mentor_group' and s.mentor_group_id::text = any(p_values))
      or (p_target_type = 'sports_house' and s.sports_house = any(p_values))
      or (p_target_type = 'class' and exists (
            select 1 from student_class sc
            where sc.student_id = s.student_id and sc.class_id::text = any(p_values)))
      or (p_target_type = 'other_half' and exists (
            select 1 from other_half_choices oc
            where oc.student_id = s.student_id and oc.activity_id::text = any(p_values)))
      or (p_target_type = 'student_group' and exists (
            select 1 from student_group_members gm
            join student_groups g on g.group_id = gm.group_id
            where gm.student_id = s.student_id and gm.group_id::text = any(p_values)
              and g.archived_at is null))
    );
$function$;

revoke execute on function public.message_group_students(text, text[]) from public, anon, authenticated;

create or replace function public.message_recipient_list(p_target_type text, p_target_value text, p_audience text)
returns table(profile_id uuid, kind text)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_values text[] := array(select trim(v) from unnest(string_to_array(coalesce(p_target_value, ''), ',')) v where trim(v) <> '');
  v_audience text := case when p_target_type = 'all_parents' then 'parents' else coalesce(p_audience, 'students') end;
begin
  if p_target_type in ('all_students', 'all_parents', 'year_group', 'form_class', 'boarding_house',
                       'mentor_group', 'sports_house', 'class', 'other_half', 'student_group') then
    if p_target_type not in ('all_students', 'all_parents') and cardinality(v_values) = 0 then
      raise exception 'Choose at least one group.';
    end if;

    return query
    with st as (select g.student_id from message_group_students(p_target_type, v_values) g)
    select p.id, 'student'::text from profiles p
    where v_audience in ('students', 'both') and p.student_id in (select st.student_id from st)
    union
    select p.id, 'parent'::text from profiles p
    where v_audience in ('parents', 'both') and p.role = 'parent'
      and exists (select 1 from student_parent sp
                  where sp.parent_id = p.parent_id and sp.student_id in (select st.student_id from st));
    return;
  end if;

  if p_audience is not null then
    raise exception 'Students, parents or both can only be chosen for a group of students.';
  end if;

  if p_target_type = 'staff_role' then
    return query
    select distinct p.id, 'staff'::text from profiles p
    join staff_roles sr on sr.staff_id = p.staff_id
    where sr.role_name = any(v_values);
  elsif p_target_type = 'all_staff' then
    return query
    select p.id, 'staff'::text from profiles p where p.staff_id is not null;
  elsif p_target_type = 'individual' then
    return query
    select p.id, case when p.parent_id is not null then 'parent' when p.student_id is not null then 'student' else 'staff' end
    from profiles p
    where p.id = any(v_values::uuid[]);
  else
    raise exception 'Unknown message target: %', p_target_type;
  end if;
end;
$function$;

revoke execute on function public.message_recipient_list(text, text, text) from public, anon, authenticated;

-- 7. The page -------------------------------------------------------------------------------

insert into public.resources (resource_key, label, section, sort_order)
values ('/groups', 'Student Groups', 'Administration', 105)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('smt', '/groups'),
  ('pastoral', '/groups'),
  ('school_office', '/groups'),
  ('teacher', '/groups')
on conflict do nothing;
