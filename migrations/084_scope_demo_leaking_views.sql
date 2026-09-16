-- Migration 084: student_summary and attendance_today are SECURITY DEFINER views
-- (created before this session, not by any prior demo migration) that bypass RLS
-- entirely and never selected an is_demo column, so they returned every real
-- student regardless of who queried them. app/students/page.js reads student_summary
-- directly for its whole listing, and app/attendance/page.js reads attendance_today —
-- both pages are on staff_demo's allowed list, so real students' names, behaviour
-- totals, exam averages, and primary parent contact phone numbers were reachable
-- from a page believed to be demo-safe. This adds the same is_demo scoping already
-- used everywhere else in the schema, directly in the view definitions.

create or replace view student_summary as
select
    s.student_id,
    s.first_name,
    s.last_name,
    s.year_group,
    s.form_class,
    s.status,
    coalesce(sum(be.points) filter (where be.type = 'positive'), 0) as positive_points,
    coalesce(sum(be.points) filter (where be.type = 'negative'), 0) as negative_points,
    coalesce(sum(be.points), 0) as net_behaviour_points,
    max(be.event_date) as last_behaviour_event_date,
    (select round(avg((r.score / nullif(r.max_score, 0)) * 100), 1)
       from results r
      where r.student_id = s.student_id
        and r.week_start_date = (select max(week_start_date) from results where student_id = s.student_id)
    ) as latest_week_avg_pct,
    (select max(r.week_start_date) from results r where r.student_id = s.student_id) as latest_results_week,
    (select p.first_name || ' ' || p.last_name
       from student_parent sp join parents p on p.parent_id = sp.parent_id
      where sp.student_id = s.student_id and sp.is_primary_contact = true limit 1) as primary_contact_name,
    (select p.phone
       from student_parent sp join parents p on p.parent_id = sp.parent_id
      where sp.student_id = s.student_id and sp.is_primary_contact = true limit 1) as primary_contact_phone
from students s
left join behaviour_events be on be.student_id = s.student_id
where s.is_demo = is_demo_account() or is_admin()
group by s.student_id, s.first_name, s.last_name, s.year_group, s.form_class, s.status;

create or replace view attendance_today as
select
    a.student_id,
    a.attend_date,
    a.period_number,
    a.code,
    ac.description,
    a.status,
    (a.status = 'present') as is_present
from attendance a
join attendance_codes ac on ac.code = a.code
where a.attend_date = current_date
  and (a.is_demo = is_demo_account() or is_admin());
