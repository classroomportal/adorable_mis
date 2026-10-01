-- Migration 313: Class Progress picks its grades in the database.
--
-- Why (the principal, 1 Oct 2026: "This is not loading"): Class Progress
-- downloaded every row of results (58,983, mostly leavers' term exams back to
-- 2017) a thousand at a time, one page after another, only to keep one grade
-- per student and subject. On a tablet the page stayed on "Loading...".
-- class_progress_grades() returns just that one grade per active student and
-- subject (about 5,000 rows), chosen the way the page chose it:
--   * with a result set: rows tagged with the set, or untagged rows from the
--     set's date (as /results/import-gradebook writes them); a tagged row wins;
--   * without one: the latest week, then the most recently entered row.
-- Rows without a grade are ignored. It runs as the caller (security invoker),
-- so results' own read policies still decide what anyone sees.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.class_progress_grades(p_event_id integer default null)
returns table (student_id integer, subject_id integer, grade text)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select distinct on (r.student_id, r.subject_id) r.student_id, r.subject_id, r.grade
  from results r
  join students s on s.student_id = r.student_id and s.status = 'active'
  left join calendar_events ev on ev.event_id = p_event_id
  where nullif(btrim(r.grade), '') is not null
    and (p_event_id is null
         or r.result_set_event_id = p_event_id
         or (r.result_set_event_id is null and r.week_start_date = ev.event_date))
  order by r.student_id, r.subject_id,
    case when p_event_id is not null and r.result_set_event_id = p_event_id then 0 else 1 end,
    r.week_start_date desc, r.result_id desc;
$$;
revoke execute on function public.class_progress_grades(integer) from public, anon;
grant execute on function public.class_progress_grades(integer) to authenticated;
