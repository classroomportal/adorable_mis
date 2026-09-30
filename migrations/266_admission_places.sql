-- Migration 266: how many boys and girls each year group can take next year.
--
-- Why: the principal asked (30 Sept 2026) for Next Year's Numbers
-- (/admissions/projections) to start from the places the school allows,
-- boys and girls separately, per year group, rather than a projected roll,
-- so the page shows how many places are left once this year's students
-- move up and the confirmed newcomers are counted.
--
-- admission_places holds one row per academic year and year group. Anyone
-- who can see applicants (/admissions) can read it; setting the numbers
-- needs the new resource '/admissions/places' (SMT; admin through
-- has_resource_access), editable at /admin/permissions. Changes are logged
-- in change_history under 'admissions', and updated_by is stamped from
-- auth.uid().

set local formwork.change_note = 'Principal (direct)';

create table if not exists public.admission_places (
  academic_year_id integer not null references public.academic_years(academic_year_id) on delete cascade,
  year_group integer not null check (year_group between 7 and 12),
  boys_allowed integer check (boys_allowed >= 0),
  girls_allowed integer check (girls_allowed >= 0),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (academic_year_id, year_group)
);

comment on table public.admission_places is
  'Places allowed per year group and gender for an academic year (migration 266). Read by /admissions/projections; set by /admissions/places holders.';

alter table public.admission_places enable row level security;
grant select, insert, update, delete on public.admission_places to authenticated;

create policy admission_places_read on public.admission_places for select to authenticated
  using (has_resource_access('/admissions') or has_resource_access('/admissions/places'));
create policy admission_places_insert on public.admission_places for insert to authenticated
  with check (has_resource_access('/admissions/places'));
create policy admission_places_update on public.admission_places for update to authenticated
  using (has_resource_access('/admissions/places'))
  with check (has_resource_access('/admissions/places'));
create policy admission_places_delete on public.admission_places for delete to authenticated
  using (has_resource_access('/admissions/places'));

create trigger trg_stamp_actor before insert or update on public.admission_places
  for each row execute function public.stamp_actor('updated_by');

create or replace function public.touch_admission_places()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_touch_admission_places before update on public.admission_places
  for each row execute function public.touch_admission_places();

create trigger trg_log_change after insert or update or delete on public.admission_places
  for each row execute function public.log_change('admissions', 'academic_year_id,year_group');

insert into resources (resource_key, label, section, sort_order) values
  ('/admissions/places', 'Places Allowed', 'Admissions', 15)
on conflict (resource_key) do nothing;

insert into role_permissions (role_name, resource_key) values
  ('smt', '/admissions/places')
on conflict do nothing;
