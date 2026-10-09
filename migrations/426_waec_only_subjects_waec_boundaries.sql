-- 426: WAEC-only subjects are graded on the WAEC scale in Years 10-11
--
-- Why: the principal, 9 Oct 2026: "WAEC only subjects need to use waec
-- grades scale", then "go ahead with all four". Migrations 422-425 printed
-- these subjects in WAEC on the Termly Grade Report and stored WAEC
-- targets, but every mark was still graded from the subject's Year 10/11
-- boundaries, which were IGCSE (A*-G; Digital Technologies' were
-- Cambridge's, migration 322). So Enter Results, the gradebook import,
-- homework marks and mark appeals kept giving IGCSE grades, and Class
-- Progress couldn't compare them with the WAEC targets.
--
-- Everything that grades a mark reads subject_grade_boundaries for the
-- subject and the student's year group, so the fix is in the boundaries:
--   1. For each subject with waec_only, Years 10 and 11 get a copy of the
--      subject's Year 12 (WAEC) boundaries in place of their IGCSE ones.
--      Assessment managers can still adjust them on Grade Boundaries.
--   2. Ticking WAEC only on Subject Settings later does the same for that
--      subject (trg_subject_waec_only_boundaries). Unticking leaves the
--      boundaries as they are; set IGCSE ones on Grade Boundaries.
--   3. Marks already in results for students now in Years 10-11 (this
--      school year, and last year too for Year 11) that have a score are
--      re-graded from the new boundaries. Marks with no score keep their
--      grade. Each change is logged in grade_history.
--   4. Homework marks (mark-type) on these subjects' Year 10-11 homework
--      are re-graded by re-saving them: homework_marks_check() works the
--      grade out from the boundaries.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.copy_waec_boundaries_to_years_10_11(p_subject_id integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not exists (
    select 1 from subject_grade_boundaries where subject_id = p_subject_id and year_group = 12
  ) then
    return; -- no WAEC boundaries to copy; leave Years 10-11 as they are
  end if;
  delete from subject_grade_boundaries
   where subject_id = p_subject_id and year_group in (10, 11);
  insert into subject_grade_boundaries (subject_id, year_group, grade, min_score, max_score)
  select b.subject_id, y.year_group, b.grade, b.min_score, b.max_score
    from subject_grade_boundaries b
   cross join (values (10), (11)) as y(year_group)
   where b.subject_id = p_subject_id and b.year_group = 12;
end;
$$;

revoke execute on function public.copy_waec_boundaries_to_years_10_11(integer) from public, anon, authenticated;

create or replace function public.subject_waec_only_boundaries()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.waec_only and not coalesce(old.waec_only, false) then
    perform copy_waec_boundaries_to_years_10_11(new.subject_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.subject_waec_only_boundaries() from public, anon, authenticated;

drop trigger if exists trg_subject_waec_only_boundaries on public.subjects;
create trigger trg_subject_waec_only_boundaries
  after update of waec_only on public.subjects
  for each row execute function public.subject_waec_only_boundaries();

-- 1. The subjects already ticked.
select public.copy_waec_boundaries_to_years_10_11(subject_id)
  from public.subjects where waec_only;

-- 3. Re-grade marks with a score.
with marks as (
  select r.result_id, st.year_group, r.subject_id,
         round(r.score / r.max_score * 100, 2) as pct, r.grade
    from public.results r
    join public.students st using (student_id)
    join public.subjects s on s.subject_id = r.subject_id
   where s.waec_only and st.status = 'active' and st.year_group in (10, 11)
     and r.week_start_date >= case when st.year_group = 11 then date '2025-09-01' else date '2026-09-01' end
     and r.score is not null and r.max_score > 0
),
regraded as (
  select m.result_id, m.grade,
         (select b.grade from public.subject_grade_boundaries b
           where b.subject_id = m.subject_id and b.year_group = m.year_group and b.min_score <= m.pct
           order by b.min_score desc limit 1) as new_grade
    from marks m
)
update public.results r
   set grade = g.new_grade
  from regraded g
 where r.result_id = g.result_id
   and g.new_grade is not null
   and g.new_grade is distinct from g.grade;

-- 4. Re-grade homework marks.
update public.homework_marks hm
   set score = hm.score
  from public.homework h
  join public.homework_schemes hs on hs.scheme_id = h.scheme_id
  join public.subjects s on s.subject_id = h.subject_id
 where hm.homework_id = h.homework_id
   and s.waec_only and h.year_group in (10, 11)
   and h.status <> 'withdrawn' and hs.kind = 'mark'
   and hm.score is not null;
