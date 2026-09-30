-- Migration 280: the order of the big dashboard tiles, set once for everyone.
--
-- Why: the principal asked (30 Sept 2026) for the new Homework tile to be
-- second on the students' screen, and for a way to arrange the tiles rather
-- than having the order written into the code. The order is school-wide (the
-- principal's choice), not per person, so every student sees the same
-- screen, as does every member of staff.
--
-- Now:
--   * dashboard_tile_order holds one row per tile per dashboard: 'student'
--     (the big tiles on a student's home page and in their portal) and
--     'staff' (the big tiles at the top of the staff dashboard). A tile with
--     no row keeps its place after the ordered ones, so a tile added later
--     appears without anyone having to arrange it first.
--   * The order is arranged at /admin/tile-order. Only people with that page
--     can change it (admins; no roles granted yet). Anyone signed in can read
--     it, since every dashboard needs it.
--   * Which tiles someone sees is unchanged: page access and the homework
--     pilot still decide that. This only decides the order.

set local formwork.change_note = 'Principal (direct)';

create table if not exists public.dashboard_tile_order (
  dashboard text not null check (dashboard in ('student', 'staff')),
  tile_key text not null check (tile_key ~ '^[a-z_]+$'),
  position integer not null check (position >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (dashboard, tile_key)
);

comment on table public.dashboard_tile_order is
  'School-wide order of the big dashboard tiles (migration 280), arranged at /admin/tile-order. Tiles without a row come after the ordered ones.';

alter table public.dashboard_tile_order enable row level security;
grant select, insert, update, delete on public.dashboard_tile_order to authenticated;

create policy "Tile order readable by all authenticated"
  on public.dashboard_tile_order for select to authenticated using (true);
create policy "Tile order arranged on Arrange Tiles"
  on public.dashboard_tile_order for all to authenticated
  using (has_resource_access('/admin/tile-order'))
  with check (has_resource_access('/admin/tile-order'));

create trigger trg_stamp_updated_by before insert or update on public.dashboard_tile_order
  for each row execute function public.stamp_actor('updated_by');

-- Today's order, with Homework second for students (the principal's request).
insert into public.dashboard_tile_order (dashboard, tile_key, position) values
  ('student', 'timetable', 0),
  ('student', 'homework', 1),
  ('student', 'other_half', 2),
  ('student', 'assessment', 3),
  ('student', 'behaviour', 4),
  ('student', 'tuckshop', 5),
  ('student', 'messages', 6),
  ('staff', 'log_behaviour', 0),
  ('staff', 'timetable', 1),
  ('staff', 'calendar', 2),
  ('staff', 'inbox', 3),
  ('staff', 'my_children', 4)
on conflict (dashboard, tile_key) do nothing;

insert into public.resources (resource_key, label, section, sort_order)
values ('/admin/tile-order', 'Arrange Tiles', 'Administration', 104)
on conflict (resource_key) do nothing;
