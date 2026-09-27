-- One picture on a behaviour event, shown to parents once the school office
-- has approved it.
--
-- Staff asked to attach a photo when logging — the tidy room behind a
-- boarding award, say, or damage behind a sanction. The picture is kept in
-- the database as base64 JPEG text, like staff photos (lib/photo.js), rather
-- than in Storage: parents then reach it through the same row-level security
-- as the event itself, and it is in the database backups. The browser shrinks
-- it to 800px on the long side at JPEG quality 0.6 before upload: enough to
-- see on a phone, not high definition. Real iPad photos (1.1-1.8 MB) came out
-- at 18-35 KB. The check below refuses anything over ~150 KB, so nothing
-- large can be stored even if it doesn't come through the app.
--
-- A picture is its own row, and events point at it. Logging for a group (a
-- whole boarding house) stores the picture once and links every event to it,
-- instead of one copy per student.
--
-- Nothing reaches a parent or student until school office or admin approve
-- it with review_behaviour_photo() — the same people who release serious
-- events (review_serious_behaviour_event). A new picture always starts
-- 'pending' whatever the insert says (set_behaviour_photo_defaults). Once
-- approved, a parent sees it only on an event of their own child that they
-- can already see (visible_to_parents, not voided), and a student only on
-- their own event. Staff see every picture, whatever its status.

create table public.behaviour_photos (
  photo_id serial primary key,
  image_jpeg_base64 text not null check (length(image_jpeg_base64) <= 200000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  uploaded_by integer references public.staff(staff_id),
  created_at timestamptz not null default now(),
  reviewed_by integer references public.staff(staff_id),
  reviewed_at timestamptz
);

alter table public.behaviour_events
  add column photo_id integer references public.behaviour_photos(photo_id) on delete set null;
create index behaviour_events_photo_id_idx on public.behaviour_events(photo_id) where photo_id is not null;

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
  new.created_at := now();
  if auth.uid() is not null then
    select staff_id into new.uploaded_by from profiles where id = auth.uid();
  end if;
  return new;
end;
$$;

create trigger behaviour_photo_defaults
  before insert on public.behaviour_photos
  for each row execute function public.set_behaviour_photo_defaults();

select public.attach_backup_mode_guard('behaviour_photos');

alter table public.behaviour_photos enable row level security;
grant select, insert, delete on public.behaviour_photos to authenticated;
grant usage, select on sequence public.behaviour_photos_photo_id_seq to authenticated;

create policy staff_read_behaviour_photos on public.behaviour_photos
  for select using (is_staff_or_admin());

create policy staff_insert_behaviour_photos on public.behaviour_photos
  for insert with check (is_staff_or_admin());

create policy admin_delete_behaviour_photos on public.behaviour_photos
  for delete using (is_admin());

create policy parent_read_approved_behaviour_photos on public.behaviour_photos
  for select using (
    status = 'approved' and exists (
      select 1
      from behaviour_events e
      join student_parent sp on sp.student_id = e.student_id
      join profiles p on p.parent_id = sp.parent_id
      where e.photo_id = behaviour_photos.photo_id
        and e.visible_to_parents and e.voided_at is null
        and p.id = auth.uid()
    )
  );

create policy student_read_approved_behaviour_photos on public.behaviour_photos
  for select using (
    status = 'approved' and exists (
      select 1
      from behaviour_events e
      join profiles p on p.student_id = e.student_id
      where e.photo_id = behaviour_photos.photo_id
        and e.voided_at is null
        and p.id = auth.uid()
    )
  );

create or replace function public.review_behaviour_photo(p_photo_id integer, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reviewer integer;
begin
  if not (is_admin() or has_staff_role(array['school_office'])) then
    raise exception 'Only school office staff or admin can review a behaviour picture'
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

revoke all on function public.review_behaviour_photo(integer, boolean) from public, anon;
grant execute on function public.review_behaviour_photo(integer, boolean) to authenticated;
