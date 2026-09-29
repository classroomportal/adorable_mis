-- Migration 264: academic years listed and added on Lookups.
--
-- Why: the principal asked (30 Sept 2026) where next year is created.
-- 2026/27 and 2027/28 were seeded by migration 256 and nothing let anyone
-- see or add academic years (the table is admin-write only, with no page).
-- /admin/lookups now lists them; its holders (admin, SMT, HR) can:
--   * add the next year (add_next_academic_year()): the year after the
--     latest, 1 September to 31 August, status 'planning';
--   * correct a year's start and end dates (set_academic_year_dates()),
--     for any year not closed, as long as years don't overlap; terms are
--     re-filed under whichever year their start date now falls in;
--   * remove a planning year nothing uses yet (delete_academic_year()).
-- Which year is current is deliberately not editable here: that changes
-- only at the year switch (design doc, Decision 6), so it can't be flipped
-- by mistake. Adding a year is now logged in change_history too.

set local formwork.change_note = 'Principal (direct)';

drop trigger if exists trg_log_change on public.academic_years;
create trigger trg_log_change after insert or update or delete on public.academic_years
  for each row execute function public.log_change('fees', 'academic_year_id');

create or replace function public.add_next_academic_year()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_start_year integer;
  v_label text;
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can add academic years.';
  end if;
  select coalesce(max(extract(year from start_date)::int), extract(year from school_today())::int - 1) + 1
    into v_start_year from academic_years;
  v_label := v_start_year || '/' || lpad(((v_start_year + 1) % 100)::text, 2, '0');
  if exists (select 1 from academic_years where end_date >= make_date(v_start_year, 9, 1)) then
    raise exception 'The latest year ends after 1 September %; correct its dates first.', v_start_year;
  end if;
  insert into academic_years (label, start_date, end_date, status)
  values (v_label, make_date(v_start_year, 9, 1), make_date(v_start_year + 1, 8, 31), 'planning');
  return v_label;
end;
$$;

create or replace function public.set_academic_year_dates(p_academic_year_id integer, p_start date, p_end date)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  y academic_years;
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change academic years.';
  end if;
  select * into y from academic_years where academic_year_id = p_academic_year_id;
  if y.academic_year_id is null then
    raise exception 'Academic year not found.';
  end if;
  if y.status = 'closed' then
    raise exception 'A closed year can''t be changed.';
  end if;
  if p_start is null or p_end is null or p_start >= p_end then
    raise exception 'The year must start before it ends.';
  end if;
  if exists (select 1 from academic_years
             where academic_year_id <> p_academic_year_id
               and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'Those dates overlap another academic year.';
  end if;

  update academic_years set start_date = p_start, end_date = p_end
   where academic_year_id = p_academic_year_id;

  -- Re-file terms under whichever year their start date now falls in.
  update terms t
     set academic_year_id = (select ay.academic_year_id from academic_years ay
                              where t.start_date between ay.start_date and ay.end_date);
end;
$$;

create or replace function public.delete_academic_year(p_academic_year_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  y academic_years;
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can remove academic years.';
  end if;
  select * into y from academic_years where academic_year_id = p_academic_year_id;
  if y.academic_year_id is null then
    raise exception 'Academic year not found.';
  end if;
  if y.status <> 'planning' then
    raise exception 'Only a year still being planned can be removed.';
  end if;
  if exists (select 1 from applicants where entry_academic_year_id = p_academic_year_id)
     or exists (select 1 from admission_sessions where academic_year_id = p_academic_year_id)
     or exists (select 1 from admission_papers where academic_year_id = p_academic_year_id)
     or exists (select 1 from fee_price_changes where academic_year_id = p_academic_year_id)
     or exists (select 1 from terms where academic_year_id = p_academic_year_id) then
    raise exception '% already has applicants, test days, papers, fee changes or terms, so it can''t be removed.', y.label;
  end if;
  delete from academic_years where academic_year_id = p_academic_year_id;
end;
$$;
