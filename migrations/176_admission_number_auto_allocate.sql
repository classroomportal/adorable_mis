-- Migration 176: allocate admission numbers automatically.
--
-- Why: the September 2026 intake added after the original student import
-- (sql/014) came in with no admission number — 30 students, all created
-- in Formwork rather than carried over from the old system. Admission
-- numbers are the school's sequential six-digit series (000001, ...,
-- 000613 at the time of writing), and nothing in Formwork was issuing the
-- next one, so every student added from now on would have been blank too.
--
-- 1. Backfill: students without a number get the next ones in the series,
--    in the order they were added (student_id), so the earliest of this
--    intake gets 000614.
-- 2. A sequence, started after the highest number in use, feeds a BEFORE
--    INSERT trigger that fills admission_number whenever a new student
--    arrives without one — whether from /students/new, the CSV import, or
--    SQL. A number supplied explicitly (e.g. a transfer keeping the number
--    the office already issued) is kept as given; the trigger skips past
--    any number already taken so the sequence can't collide with one.
-- 3. The trigger also stops an edit blanking an existing number: an
--    admission number, once issued, is the student's for good.
-- 4. A unique index, so two students can never share a number. All 261
--    existing numbers are distinct, so this adds cleanly.
--
-- Numbers stay text, zero-padded to six digits, matching the existing
-- series and the old system's exports.

create sequence if not exists public.students_admission_number_seq;

-- Backfill, then point the sequence past the highest number now in use.
with numbered as (
  select student_id,
         row_number() over (order by student_id) as n
  from public.students
  where admission_number is null or btrim(admission_number) = ''
),
base as (
  select coalesce(max(admission_number::integer), 0) as top
  from public.students
  where admission_number ~ '^[0-9]+$'
)
update public.students s
set admission_number = lpad((base.top + numbered.n)::text, 6, '0')
from numbered, base
where s.student_id = numbered.student_id;

select setval('public.students_admission_number_seq',
  (select coalesce(max(admission_number::integer), 0) from public.students where admission_number ~ '^[0-9]+$') + 1,
  false);

create or replace function public.assign_admission_number()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  candidate text;
begin
  if new.admission_number is not null and btrim(new.admission_number) <> '' then
    new.admission_number := btrim(new.admission_number);
    return new;
  end if;

  -- Blanked on an edit: keep the number the student already had.
  if tg_op = 'UPDATE' and old.admission_number is not null then
    new.admission_number := old.admission_number;
    return new;
  end if;

  loop
    candidate := lpad(nextval('public.students_admission_number_seq')::text, 6, '0');
    exit when not exists (select 1 from public.students where admission_number = candidate);
  end loop;
  new.admission_number := candidate;
  return new;
end;
$$;

drop trigger if exists trg_assign_admission_number on public.students;
create trigger trg_assign_admission_number
  before insert or update of admission_number on public.students
  for each row execute function public.assign_admission_number();

create unique index if not exists students_admission_number_key
  on public.students (admission_number);
