-- ============================================
-- Migration 039: subject_grade_boundaries
-- Grade cutoffs defined per subject (not globally),
-- used to compute `results.grade` from `results.score`.
-- Seeded with WAEC 9-point scale as a starting guess for
-- every existing subject — edit via /admin/grade-boundaries.
-- ============================================

create table subject_grade_boundaries (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references subjects(subject_id) on delete cascade,
  grade text not null,
  min_score numeric not null,
  max_score numeric not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(subject_id, grade)
);

alter table subject_grade_boundaries enable row level security;

create policy "staff manage grade boundaries" on subject_grade_boundaries
  for all using (is_staff_or_admin());

create policy "students view grade boundaries" on subject_grade_boundaries
  for select using (auth.uid() is not null);

create or replace function touch_sgb_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_sgb_updated_at
before update on subject_grade_boundaries
for each row execute function touch_sgb_updated_at();

-- Seed every existing subject with the WAEC 9-point scale as a guess.
-- These are placeholders — review and adjust per subject on the admin page.
insert into subject_grade_boundaries (subject_id, grade, min_score, max_score)
select s.subject_id, b.grade, b.min_score, b.max_score
from subjects s
cross join (values
  ('A1', 75, 100),
  ('B2', 70, 74),
  ('B3', 65, 69),
  ('C4', 60, 64),
  ('C5', 55, 59),
  ('C6', 50, 54),
  ('D7', 45, 49),
  ('E8', 40, 44),
  ('F9', 0, 39)
) as b(grade, min_score, max_score)
on conflict (subject_id, grade) do nothing;
