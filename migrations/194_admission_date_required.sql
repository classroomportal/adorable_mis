-- 194_admission_date_required.sql
--
-- A student's admission_date is what decides whether they count as a new
-- student (report_periods.joined_from, migration 193), so a student without
-- one silently drops out of the "New students check". Nine students added
-- this term by hand through /students/new had none, because that form never
-- asked for it - the CSV import is the only path that ever set it.
--
-- 1. Those nine joined this term: the school has confirmed 19 September 2026
--    for all of them. With them fixed, no student (active or left) is
--    missing a date.
-- 2. admission_date becomes NOT NULL, so no future path can leave it out.
-- 3. A BEFORE INSERT trigger fills a missing date with school_today() (the
--    Lagos date, not the UTC current_date). The CSV import sends an explicit
--    NULL for a blank cell, which a column default wouldn't catch; a trigger
--    does, so a bulk import of new joiners without the column still works
--    and dates them the day they were entered. /students/new now asks for
--    the date too (defaulting to today) so it can be set correctly up front.

update public.students
set admission_date = date '2026-09-19'
where admission_date is null
  and student_id in (289, 290, 291, 292, 293, 294, 295, 296, 297);

create or replace function public.default_admission_date()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.admission_date is null then
    new.admission_date := school_today();
  end if;
  return new;
end;
$$;

create trigger trg_default_admission_date
  before insert on public.students
  for each row execute function public.default_admission_date();

alter table public.students
  alter column admission_date set not null;
