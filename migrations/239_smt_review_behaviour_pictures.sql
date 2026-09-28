-- 239_smt_review_behaviour_pictures.sql
--
-- Any behaviour event with a picture is reviewed by SMT, not the school
-- office. The principal decided this on 28 Sep 2026. SMT (and admin) now decide
-- a picture event's text and picture on /behaviour/review. The school office
-- keeps reviewing -5 events that have no picture.
--
-- Changed:
--   - review_behaviour_for_parents() (migration 238): if any of the events
--     has a picture, the caller must be SMT or admin; otherwise school
--     office or admin, as before.
--   - review_behaviour_photo() (209): SMT or admin.
--   - review_serious_behaviour_event() (166): a -5 event with a picture now
--     needs SMT or admin too, so the older function can't get round the rule.
--   - notify_office_of_behaviour_photos() (212): the "Picture to check"
--     inbox notice goes to SMT only (admins if nobody holds the role), and
--     says SMT approve it. It went to school office and SMT before.
--   - role_permissions: SMT get /behaviour/review. Until now only admin and
--     hr had it, so MEK and RIG couldn't open the page.
--
-- Applied to the live database through the Supabase connector on
-- 28 Sep 2026; this file records it.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.review_behaviour_for_parents(
  p_event_ids integer[],
  p_send_text boolean,
  p_send_picture boolean,
  p_protocol_confirmed boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reviewer integer;
  v_found integer;
begin
  if p_event_ids is null or cardinality(p_event_ids) = 0 then
    raise exception 'No behaviour events given.';
  end if;

  if exists (select 1 from behaviour_events where event_id = any(p_event_ids) and photo_id is not null) then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can send a behaviour event to parents'
      using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_found
  from behaviour_events
  where event_id = any(p_event_ids) and voided_at is null;
  if v_found <> cardinality(array(select distinct unnest(p_event_ids))) then
    raise exception 'Behaviour event not found, or it has been withdrawn.';
  end if;

  if p_send_text and not coalesce(p_protocol_confirmed, false) then
    raise exception 'Protocol confirmation is required before sending the text to parents';
  end if;

  if p_send_text and exists (
    select 1 from behaviour_events
    where event_id = any(p_event_ids)
      and type = 'negative' and points > -5 and photo_id is null
  ) then
    raise exception 'Only -5 events, or events with a picture, can be sent to parents from the review';
  end if;

  if p_send_picture is not null and exists (
    select 1 from behaviour_events where event_id = any(p_event_ids) and photo_id is null
  ) then
    raise exception 'This behaviour event has no picture.';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  if p_send_text is not null then
    update behaviour_events
    set visible_to_parents = p_send_text,
        protocol_reviewed_by = v_reviewer,
        protocol_reviewed_at = now()
    where event_id = any(p_event_ids)
      and type = 'negative';
  end if;

  if p_send_picture is not null then
    update behaviour_photos
    set status = case when p_send_picture then 'approved' else 'rejected' end,
        reviewed_by = v_reviewer,
        reviewed_at = now()
    where photo_id in (
      select photo_id from behaviour_events where event_id = any(p_event_ids)
    );
  end if;
end;
$$;

create or replace function public.review_behaviour_photo(p_photo_id integer, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reviewer integer;
begin
  if not (is_admin() or has_staff_role(array['smt'])) then
    raise exception 'Only SMT or admin can review a behaviour picture'
      using errcode = 'insufficient_privilege';
  end if;

  select staff_id into v_reviewer from profiles where id = auth.uid();

  update behaviour_photos
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = v_reviewer,
      reviewed_at = now()
  where photo_id = p_photo_id;

  if not found then
    raise exception 'Behaviour picture % not found.', p_photo_id;
  end if;
end;
$$;

create or replace function public.review_serious_behaviour_event(p_event_id integer, p_visible_to_parents boolean, p_protocol_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event behaviour_events%rowtype;
  v_reviewer_staff_id integer;
begin
  if not (is_admin() or has_staff_role(array['school_office', 'smt'])) then
    raise exception 'Only school office staff, SMT or admin can review a behaviour event';
  end if;

  select * into v_event from behaviour_events where event_id = p_event_id;
  if not found then
    raise exception 'Behaviour event % not found', p_event_id;
  end if;

  if v_event.photo_id is not null then
    if not (is_admin() or has_staff_role(array['smt'])) then
      raise exception 'Only SMT or admin can review a behaviour event with a picture';
    end if;
  elsif not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can review a behaviour event';
  end if;

  if v_event.type <> 'negative' or v_event.points > -5 then
    raise exception 'Only serious (negative, -5 point) events go through this review';
  end if;

  if p_visible_to_parents and not p_protocol_confirmed then
    raise exception 'Protocol confirmation is required before releasing this event to parents';
  end if;

  select staff_id into v_reviewer_staff_id from profiles where id = auth.uid();

  update behaviour_events
  set visible_to_parents = p_visible_to_parents,
      protocol_reviewed_by = v_reviewer_staff_id,
      protocol_reviewed_at = now()
  where event_id = p_event_id;
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
  where sr.role_name = 'smt';
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
              ' added a picture to a behaviour event. Parents can''t see it until SMT approve it.</p>' ||
              '<p><strong>Category:</strong> ' || coalesce(r.category, '—') ||
              ' (' || case when r.points > 0 then '+' else '' end || coalesce(r.points::text, '—') || ')<br/>' ||
              '<strong>Date:</strong> ' || to_char(r.event_date, 'Dy DD Mon YYYY') || '<br/>' ||
              '<strong>' || case when v_count = 1 then 'Student' else 'Students (' || v_count || ')' end ||
              ':</strong> ' || coalesce(v_names, '—') || '</p>' ||
              '<p>Review it: https://misform.work/behaviour/review</p>';

    perform post_inbox_notice(v_recipients, v_subject, v_html, 'behaviour_photo');
    update behaviour_photos set office_notified_at = now() where photo_id = r.photo_id;
  end loop;

  return null;
end;
$$;

insert into public.role_permissions (role_name, resource_key)
values ('smt', '/behaviour/review')
on conflict do nothing;
