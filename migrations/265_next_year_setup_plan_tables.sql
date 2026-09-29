-- Migration 265: next year's setup: mentor structure first, then the
-- timetable, in plan tables the live school never reads.
--
-- Why: phase 4 of docs/admissions-and-year-rollover-design.md, as the
-- principal asked for it (30 Sept 2026): setting up next year follows on
-- from creating that academic year, and the first step is the mentor
-- structure; only then is next year's Nova-T timetable imported.
--
-- Next year's Nova-T class codes are the same as this year's (next year's
-- 8a/Ma1 holds this year's Y7s), and the importer matches classes by code,
-- so next year's timetable can't go into classes / timetable_slots while
-- this year is still being taught. It goes into plan_* copies of those
-- tables, keyed by academic year. Registers, timetables, class lists and
-- every other page keep reading the live tables; nothing here changes
-- them. The switch (phase 5) will move the plan into the live tables.
--
-- Tables:
--   * plan_mentor_groups / plan_mentor_assignments: next year's mentor
--     groups and their mentors (the live equivalents are mentor_groups and
--     staff_roles 'mentor' scoped to a group name).
--   * academic_years.mentor_structure_confirmed_at/_by: step 1 done. The
--     Nova-T import for that year stays locked until it is set.
--   * plan_curriculum_blocks, plan_classes, plan_timetable_slots,
--     plan_student_class: the same columns as the live tables plus
--     academic_year_id, which triggers fill from the class, so the importer
--     only has to point at different table names. Slots take their times
--     from bell_times like the live ones, and plan_student_class takes its
--     block from the class, with the same one-class-per-block rule.
--
-- Who: reading is open to staff (it's a timetable). Writing is for
-- /admin/next-year (SMT; admin through has_resource_access) and the Nova-T
-- importer's holders; class allocation also for can_allocate_classes()
-- (admin, head of department, pastoral), as for live allocation. The
-- backup-mode guard is added to new tables automatically.

set local formwork.change_note = 'Principal (direct)';

-- 0. Who may edit next year's plan ---------------------------------------------

create or replace function public.can_edit_next_year()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select has_resource_access('/admin/next-year') or has_resource_access('/admin/import-classes');
$$;

insert into resources (resource_key, label, section, sort_order) values
  ('/admin/next-year', 'Next Year Setup', 'Timetable', 5)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('smt', '/admin/next-year')
on conflict do nothing;

-- 1. Mentor structure -------------------------------------------------------------

alter table public.academic_years
  add column if not exists mentor_structure_confirmed_at timestamptz,
  add column if not exists mentor_structure_confirmed_by uuid;

create table if not exists public.plan_mentor_groups (
  plan_mentor_group_id integer generated always as identity primary key,
  academic_year_id integer not null references public.academic_years(academic_year_id) on delete cascade,
  group_name text not null check (btrim(group_name) <> ''),
  year_group integer not null check (year_group between 7 and 12),
  description text,
  unique (academic_year_id, group_name)
);

create table if not exists public.plan_mentor_assignments (
  academic_year_id integer not null,
  group_name text not null,
  staff_id integer not null references public.staff(staff_id),
  primary key (academic_year_id, group_name, staff_id),
  foreign key (academic_year_id, group_name)
    references public.plan_mentor_groups (academic_year_id, group_name) on update cascade on delete cascade
);

comment on table public.plan_mentor_groups is
  'Next year''s mentor groups (migration 265), set up at /admin/next-year before the timetable. Become mentor_groups at the year switch.';

alter table public.plan_mentor_groups enable row level security;
grant select, insert, update, delete on public.plan_mentor_groups to authenticated;
alter table public.plan_mentor_assignments enable row level security;
grant select, insert, update, delete on public.plan_mentor_assignments to authenticated;

create policy "Plan mentor groups readable by staff" on public.plan_mentor_groups
  for select to authenticated using (is_staff_or_admin());
create policy "Plan mentor groups edited in next year setup" on public.plan_mentor_groups
  for all to authenticated using (has_resource_access('/admin/next-year')) with check (has_resource_access('/admin/next-year'));
create policy "Plan mentor assignments readable by staff" on public.plan_mentor_assignments
  for select to authenticated using (is_staff_or_admin());
create policy "Plan mentor assignments edited in next year setup" on public.plan_mentor_assignments
  for all to authenticated using (has_resource_access('/admin/next-year')) with check (has_resource_access('/admin/next-year'));

create or replace function public.confirm_mentor_structure(p_academic_year_id integer, p_confirmed boolean)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admin/next-year') then
    raise exception 'Only staff with Next Year Setup can confirm the mentor structure.';
  end if;
  if not exists (select 1 from academic_years where academic_year_id = p_academic_year_id and status = 'planning') then
    raise exception 'Only a year being planned can be set up.';
  end if;
  if p_confirmed and not exists (select 1 from plan_mentor_groups where academic_year_id = p_academic_year_id) then
    raise exception 'Add next year''s mentor groups first.';
  end if;
  update academic_years
     set mentor_structure_confirmed_at = case when p_confirmed then now() end,
         mentor_structure_confirmed_by = case when p_confirmed then auth.uid() end
   where academic_year_id = p_academic_year_id;
end;
$$;

-- 2. Timetable plan tables ----------------------------------------------------------

create table if not exists public.plan_curriculum_blocks (
  block_id integer generated always as identity primary key,
  academic_year_id integer not null references public.academic_years(academic_year_id) on delete cascade,
  block_name text not null,
  year_group integer not null,
  band text,
  is_compound boolean not null default false,
  unique (academic_year_id, block_name, year_group, band)
);

create table if not exists public.plan_classes (
  class_id integer generated always as identity primary key,
  academic_year_id integer not null references public.academic_years(academic_year_id) on delete cascade,
  subject_id integer not null references public.subjects(subject_id),
  staff_id integer references public.staff(staff_id),
  year_group integer not null,
  room text,
  class_code text,
  block_id integer references public.plan_curriculum_blocks(block_id),
  block_group text,
  unique (academic_year_id, class_code)
);

create table if not exists public.plan_timetable_slots (
  slot_id integer generated always as identity primary key,
  academic_year_id integer references public.academic_years(academic_year_id) on delete cascade,
  class_id integer not null references public.plan_classes(class_id) on delete cascade,
  day_of_week text not null,
  period_number integer not null,
  start_time time not null,
  end_time time not null,
  staff_id integer references public.staff(staff_id),
  room text
);

create index if not exists plan_timetable_slots_class on public.plan_timetable_slots (class_id);
create index if not exists plan_timetable_slots_year on public.plan_timetable_slots (academic_year_id);

create table if not exists public.plan_student_class (
  student_id integer not null references public.students(student_id),
  class_id integer not null references public.plan_classes(class_id) on delete cascade,
  academic_year_id integer references public.academic_years(academic_year_id) on delete cascade,
  block_id integer,
  is_compound boolean not null default false,
  primary key (student_id, class_id)
);

create index if not exists plan_student_class_class on public.plan_student_class (class_id);
create unique index if not exists plan_student_class_one_per_block
  on public.plan_student_class (student_id, block_id) where block_id is not null and not is_compound;

comment on table public.plan_classes is
  'Next year''s classes from its Nova-T timetable (migration 265), imported at /admin/import-classes?plan=<year>. Not read by any live page; become classes at the year switch.';

-- Slots and enrolments take their year (and enrolments their block) from the
-- class, so the importer can insert them exactly as it does live rows.
create or replace function public.plan_row_from_class()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_table_name = 'plan_student_class' then
    select c.academic_year_id, c.block_id, coalesce(b.is_compound, false)
      into new.academic_year_id, new.block_id, new.is_compound
      from plan_classes c left join plan_curriculum_blocks b on b.block_id = c.block_id
     where c.class_id = new.class_id;
  else
    select c.academic_year_id into new.academic_year_id from plan_classes c where c.class_id = new.class_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_row_from_class() from public, anon, authenticated;

create trigger trg_plan_row_from_class before insert or update of class_id on public.plan_timetable_slots
  for each row execute function public.plan_row_from_class();
create trigger trg_plan_row_from_class before insert or update of class_id on public.plan_student_class
  for each row execute function public.plan_row_from_class();
create trigger plan_timetable_slots_take_bell_time before insert on public.plan_timetable_slots
  for each row execute function public.timetable_slot_takes_bell_time();

-- (The backup-mode guard, a_backup_mode_guard, is added to every new table
-- automatically by the database, so it isn't created here.)

alter table public.plan_curriculum_blocks enable row level security;
grant select, insert, update, delete on public.plan_curriculum_blocks to authenticated;
alter table public.plan_classes enable row level security;
grant select, insert, update, delete on public.plan_classes to authenticated;
alter table public.plan_timetable_slots enable row level security;
grant select, insert, update, delete on public.plan_timetable_slots to authenticated;
alter table public.plan_student_class enable row level security;
grant select, insert, update, delete on public.plan_student_class to authenticated;

create policy "Plan blocks readable by staff" on public.plan_curriculum_blocks
  for select to authenticated using (is_staff_or_admin());
create policy "Plan blocks edited in next year setup" on public.plan_curriculum_blocks
  for all to authenticated using (can_edit_next_year()) with check (can_edit_next_year());
create policy "Plan classes readable by staff" on public.plan_classes
  for select to authenticated using (is_staff_or_admin());
create policy "Plan classes edited in next year setup" on public.plan_classes
  for all to authenticated using (can_edit_next_year()) with check (can_edit_next_year());
create policy "Plan lessons readable by staff" on public.plan_timetable_slots
  for select to authenticated using (is_staff_or_admin());
create policy "Plan lessons edited in next year setup" on public.plan_timetable_slots
  for all to authenticated using (can_edit_next_year()) with check (can_edit_next_year());
create policy "Plan enrolments readable by staff" on public.plan_student_class
  for select to authenticated using (is_staff_or_admin());
create policy "Plan enrolments edited by allocators" on public.plan_student_class
  for all to authenticated using (can_edit_next_year() or can_allocate_classes())
  with check (can_edit_next_year() or can_allocate_classes());

-- The Nova-T import for a year stays locked until its mentor structure is
-- confirmed: a new plan class needs a confirmed year.
create or replace function public.plan_class_needs_mentor_structure()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (select 1 from academic_years
                  where academic_year_id = new.academic_year_id
                    and status = 'planning' and mentor_structure_confirmed_at is not null) then
    raise exception 'Set up and confirm next year''s mentor structure before importing its timetable.';
  end if;
  return new;
end;
$$;

revoke execute on function public.plan_class_needs_mentor_structure() from public, anon, authenticated;

create trigger trg_plan_class_needs_mentor_structure before insert on public.plan_classes
  for each row execute function public.plan_class_needs_mentor_structure();
