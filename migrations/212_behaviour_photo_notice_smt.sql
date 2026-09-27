-- SMT get the "Picture to check" inbox notice too.
--
-- Migration 210 sent it to school_office only (admins if nobody held the
-- role). SMT asked to see them as well, so the recipients are now everyone
-- with the school_office or smt role, each once (array_agg distinct) even if
-- they hold both. Approving stays with school office and admin
-- (review_behaviour_photo); SMT are told, not asked to act. Otherwise
-- unchanged from 210.

create or replace function public.notify_office_of_behaviour_photos()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_recipients uuid[];
  v_count integer;
  v_names text;
  v_uploader text;
  v_subject text;
  v_html text;
begin
  select array_agg(distinct p.id) into v_recipients
  from profiles p
  join staff_roles sr on sr.staff_id = p.staff_id
  where sr.role_name in ('school_office', 'smt');
  if v_recipients is null then
    select array_agg(id) into v_recipients from profiles where role = 'admin';
  end if;

  for r in
    select n.photo_id,
           min(n.category) as category,
           min(n.points) as points,
           min(n.event_date) as event_date,
           min(n.type) as type
    from new_rows n
    join behaviour_photos ph on ph.photo_id = n.photo_id
    where n.photo_id is not null
      and not n.is_demo
      and ph.status = 'pending'
      and ph.office_notified_at is null
    group by n.photo_id
  loop
    select count(*) into v_count from behaviour_events where photo_id = r.photo_id;

    -- A whole boarding house can be 50+ students: name the first ten.
    select string_agg(name, ', ' order by last_name) into v_names
    from (
      select s.first_name || ' ' || s.last_name as name, s.last_name
      from behaviour_events e
      join students s on s.student_id = e.student_id
      where e.photo_id = r.photo_id
      order by s.last_name
      limit 10
    ) x;
    if v_count > 10 then
      v_names := v_names || ' and ' || (v_count - 10) || ' more';
    end if;

    select st.first_name || ' ' || st.last_name into v_uploader
    from behaviour_photos ph join staff st on st.staff_id = ph.uploaded_by
    where ph.photo_id = r.photo_id;

    v_subject := 'Picture to check: ' || coalesce(r.category, 'Behaviour event') || ' — ' ||
      case when v_count = 1 then v_names else v_count || ' students' end;

    v_html := '<p>' || coalesce(v_uploader, 'A member of staff') ||
              ' added a picture to a behaviour event. Parents can''t see it until the school office approves it.</p>' ||
              '<p><strong>Category:</strong> ' || coalesce(r.category, '—') ||
              ' (' || case when r.points > 0 then '+' else '' end || coalesce(r.points::text, '—') || ')<br/>' ||
              '<strong>Date:</strong> ' || to_char(r.event_date, 'Dy DD Mon YYYY') || '<br/>' ||
              '<strong>' || case when v_count = 1 then 'Student' else 'Students (' || v_count || ')' end ||
              ':</strong> ' || coalesce(v_names, '—') || '</p>' ||
              '<p>Approve or reject it: https://misform.work/behaviour/review</p>';

    perform post_inbox_notice(v_recipients, v_subject, v_html, 'behaviour_photo');
    update behaviour_photos set office_notified_at = now() where photo_id = r.photo_id;
  end loop;

  return null;
end;
$$;
