-- Migration 289: a homework mark is converted to a grade.
--
-- Why: the principal asked (30 Sept 2026) that when a teacher enters a mark
-- (e.g. 11 out of 14), it is converted to a grade, as scores are elsewhere
-- in Formwork. Until now a mark-type homework stored the number only.
--
-- Now:
--   * For "Mark out of …" and "Percentage" homework, the database works out
--     the percentage (mark ÷ out of × 100) and the grade from the subject's
--     grade boundaries for the class's year group (subject_grade_boundaries,
--     the same boundaries results use: A*–G for Years 7–11, WAEC for Year 12).
--     The grade is stored in homework_marks.grade beside the mark.
--   * The grade is always the database's: whatever grade the page sends with
--     a mark is ignored and recalculated, so it can't be set by hand.
--   * The band is the highest one whose minimum the percentage reaches, so a
--     percentage between two bands (78.6%) takes the lower band, as
--     transcripts do. No boundaries for that subject and year: the mark is
--     kept and the grade left empty.
--   * "Not handed in" and "Excused" still take no mark; list-type schemes
--     (A*–U, 9–1, WAEC, Effort, Complete / Incomplete) are unchanged.
--   * Changing a boundary later does not regrade saved homework marks (as
--     for results); re-saving a mark does.
--   * Still outside reporting: nothing in reports reads these grades.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.homework_marks_check()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  h homework;
  s homework_schemes;
  v_max numeric;
begin
  if tg_op = 'UPDATE' and (new.homework_id <> old.homework_id or new.student_id <> old.student_id) then
    raise exception 'A mark can''t be moved to another homework or student.';
  end if;

  select * into h from homework where homework_id = new.homework_id;
  if h.status = 'withdrawn' then
    raise exception 'This homework has been withdrawn, so it can''t be marked.';
  end if;
  if tg_op = 'INSERT' and not exists (
    select 1 from student_class sc where sc.class_id = h.class_id and sc.student_id = new.student_id
  ) then
    raise exception 'That student isn''t in this class.';
  end if;

  select * into s from homework_schemes where scheme_id = h.scheme_id;
  new.grade := nullif(btrim(coalesce(new.grade, '')), '');
  new.comment := nullif(btrim(coalesce(new.comment, '')), '');

  if new.grade in ('Not handed in', 'Excused') then
    new.score := null;
  elsif s.kind = 'mark' then
    if new.score is null then
      raise exception 'Enter a mark, or Not handed in / Excused.';
    end if;
    v_max := coalesce(h.out_of, s.fixed_max);
    if new.score < 0 or new.score > v_max then
      raise exception 'The mark must be between 0 and %.', v_max;
    end if;
    -- The grade comes from the subject's boundaries, never from the page.
    new.grade := (
      select b.grade from subject_grade_boundaries b
      where b.subject_id = h.subject_id and b.year_group = h.year_group
        and b.min_score <= round(new.score / v_max * 100, 2)
      order by b.min_score desc
      limit 1);
  elsif s.kind = 'list' then
    new.score := null;
    if new.grade is null or not exists (
      select 1 from homework_scheme_values v where v.scheme_id = s.scheme_id and v.value = new.grade
    ) then
      raise exception '"%" isn''t a grade in %.', coalesce(new.grade, ''), s.name;
    end if;
  else
    raise exception 'This homework isn''t graded: record Not handed in or Excused only.';
  end if;

  new.subject_id := h.subject_id;
  if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Marks already saved get their grade (none had been entered when this was
-- written, so this is a safeguard).
update public.homework_marks m set score = m.score
from public.homework h join public.homework_schemes s on s.scheme_id = h.scheme_id
where h.homework_id = m.homework_id and s.kind = 'mark' and m.score is not null;
