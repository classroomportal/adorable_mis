-- Migration 364: the DSL can mark a sick-bay log entry as safeguarding,
-- which hides what the student came in with and what was observed from
-- everyone but the DSL. The medicine given stays visible.
--
-- Why (the principal, 4 Oct 2026): "DSL can add record and identify it as
-- safeguarding issue and hide details from anyone else", then "the dsl
-- ticking should not hide drugs given just the description of symptoms".
-- Builds on migration 363 (the dsl role), which must be run first.
--
-- Row security can hide whole rows but not some columns of some rows, so the
-- symptom description moves out of the visit into its own table that only
-- the DSL can read:
--   * student_clinic_visits.safeguarding: ticked by a DSL when recording a
--     visit, or later on any entry (a nurse's included). Only a DSL can tick
--     or untick it.
--   * While ticked, the visit's `reason` (presenting complaint) and
--     `observations` are kept in student_clinic_visit_safeguarding and the
--     visit itself shows "Safeguarding: details held by the DSL" with no
--     observations. Everything else stays visible to the nurses as before:
--     when, type, temperature, treatment, medication and dose, outcome,
--     parent told, follow-up.
--   * Unticking puts the description back on the visit and removes the
--     hidden copy.
--   * safeguarding_flagged_by / _at record who ticked it and when, from
--     auth.uid(); whatever the request sends is overwritten.
-- The hidden table has a select policy for the DSL only and no write grant:
-- only the trigger below (SECURITY DEFINER) writes to it. Admins see neither
-- the hidden text nor, since 363, any medical record.

set local formwork.change_note = 'Principal (direct)';

alter table public.student_clinic_visits
  add column if not exists safeguarding boolean not null default false,
  add column if not exists safeguarding_flagged_by uuid references auth.users(id),
  add column if not exists safeguarding_flagged_at timestamptz;

create table if not exists public.student_clinic_visit_safeguarding (
  visit_id bigint primary key
    references public.student_clinic_visits(visit_id) on delete cascade
    deferrable initially deferred,   -- written from the visit's BEFORE INSERT trigger
  reason text not null,
  observations text,
  created_at timestamptz not null default now()
);

alter table public.student_clinic_visit_safeguarding enable row level security;
grant select on public.student_clinic_visit_safeguarding to authenticated;

create policy dsl_read_safeguarding_details on public.student_clinic_visit_safeguarding
  for select to authenticated
  using ((select has_staff_role(array['dsl'])));

create or replace function public.clinic_visit_safeguarding()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_placeholder constant text := 'Safeguarding: details held by the DSL';
  v_was boolean := case when tg_op = 'INSERT' then false else old.safeguarding end;
begin
  if new.safeguarding is distinct from v_was then
    if auth.uid() is not null and not has_staff_role(array['dsl']) then
      raise exception 'Only the DSL can mark or unmark a sick-bay entry as safeguarding';
    end if;

    if new.safeguarding then
      insert into student_clinic_visit_safeguarding (visit_id, reason, observations)
      values (new.visit_id, new.reason, new.observations)
      on conflict (visit_id) do update
        set reason = excluded.reason, observations = excluded.observations;
      new.reason := v_placeholder;
      new.observations := null;
      new.safeguarding_flagged_by := auth.uid();
      new.safeguarding_flagged_at := now();
    else
      select s.reason, s.observations into new.reason, new.observations
      from student_clinic_visit_safeguarding s where s.visit_id = new.visit_id;
      new.reason := coalesce(new.reason, old.reason);
      delete from student_clinic_visit_safeguarding where visit_id = new.visit_id;
      new.safeguarding_flagged_by := null;
      new.safeguarding_flagged_at := null;
    end if;
  else
    if new.safeguarding then
      -- Still marked: keep the description off the visit whatever is sent.
      new.reason := v_placeholder;
      new.observations := null;
    end if;
    if tg_op = 'UPDATE' then
      new.safeguarding_flagged_by := old.safeguarding_flagged_by;
      new.safeguarding_flagged_at := old.safeguarding_flagged_at;
    else
      new.safeguarding_flagged_by := null;
      new.safeguarding_flagged_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_clinic_visit_safeguarding
  before insert or update on public.student_clinic_visits
  for each row execute function public.clinic_visit_safeguarding();
