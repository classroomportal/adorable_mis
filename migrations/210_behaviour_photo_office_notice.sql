-- Tell the school office in their Formwork inbox when a behaviour picture is
-- waiting for them.
--
-- Pictures on behaviour events (migration 209) stay hidden from parents until
-- school office or admin approve them on /behaviour/review, but nothing told
-- the office one was there. Now, when events are logged with a picture, every
-- school_office login gets one inbox notice for that picture (admins if
-- nobody holds the role), through post_inbox_notice() like behaviour alerts
-- and detention notices (migrations 203/204). Inbox only, no email.
--
-- Logging for a group inserts all its events in one statement and they share
-- one picture, so this is a statement-level trigger and sends one notice per
-- picture, naming how many students it covers, not one per student.
-- behaviour_photos.office_notified_at makes sure a picture is only announced
-- once.

alter table public.behaviour_photos add column office_notified_at timestamptz;

-- A new picture is never marked as already announced.
create or replace function public.set_behaviour_photo_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.office_notified_at := null;
  new.created_at := now();
  if auth.uid() is not null then
    select staff_id into new.uploaded_by from profiles where id = auth.uid();
  end if;
  return new;
end;
$$;

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
  where sr.role_name = 'school_office';
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

revoke execute on function public.notify_office_of_behaviour_photos() from public, anon, authenticated;

create trigger trg_notify_office_of_behaviour_photos
  after insert on public.behaviour_events
  referencing new table as new_rows
  for each statement execute function public.notify_office_of_behaviour_photos();
