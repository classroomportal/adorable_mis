-- Migration 117: backup mode — a system-wide, self-healing write freeze
--
-- WHY: the nightly dump is transactionally consistent on its own (pg_dump
-- takes an MVCC snapshot), so this is not about a corrupt backup. It is
-- about a *known* restore point. Before a risky operation — an end-of-year
-- rollover, a bulk import, a big data correction — an admin wants to be able
-- to say "this backup is exactly the state of the school at 08:05, and
-- nothing staff did afterwards is hiding in it". That needs writes stopped
-- while the dump runs, not merely a consistent snapshot of a moving target.
--
-- WHY IN POSTGRES AND NOT IN THE APP: pages talk to Supabase directly from
-- the client (see CLAUDE.md), so a UI-level freeze is a courtesy a stale tab
-- ignores. The only place a freeze can actually hold is the database.
--
-- HOW: one statement-level BEFORE trigger on every table in `public`, which
-- raises when backup mode is active. Statement-level rather than row-level
-- so a 5,000-row import costs one check, not 5,000.
--
-- The dangerous failure here is not "the freeze didn't work", it is "the
-- school cannot write to its MIS and nobody can undo it". Four independent
-- ways out, so that cannot happen:
--
--   1. expires_at — backup mode is only ever active *until a deadline*.
--      is_backup_mode_active() returns false once it passes, so a crashed
--      browser, a failed GitHub run, or an admin going home mid-backup all
--      self-heal with no intervention.
--   2. Any admin can call end_backup_mode(), not just the one who started
--      it, so a second admin can always rescue the first.
--   3. The admin who started it is exempt from the freeze, so they can
--      still drive the UI and fix data while it is on.
--   4. Superuser sessions (the Supabase SQL editor, migrations) are exempt
--      unconditionally, so there is always a way in from outside the app.
--
-- The control table is deliberately NOT guarded — guarding it would make
-- turning backup mode off impossible, which is the one bug that would
-- matter.

-- ---------------------------------------------------------------------------
-- Control table: exactly one row, ever.
-- ---------------------------------------------------------------------------

create table if not exists public.system_backup_mode (
  -- `id` is a boolean with a check constraint rather than an integer: it can
  -- only ever hold true, so a second row is impossible by construction.
  id            boolean primary key default true check (id),
  active        boolean not null default false,
  started_at    timestamptz,
  started_by    uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz,
  reason        text,
  -- Set by the app once it has kicked off the GitHub Actions run, so the
  -- admin page can link straight to the log rather than guessing.
  run_reference text,
  updated_at    timestamptz not null default now()
);

insert into public.system_backup_mode (id, active)
values (true, false)
on conflict (id) do nothing;

alter table public.system_backup_mode enable row level security;

-- Everyone signed in can read it: the read-only banner has to render for the
-- staff being frozen out, not just for admins.
--
-- The GRANT is not redundant with the policy. A policy only narrows access
-- that a grant has already given; without it every staff member gets
-- "permission denied for table system_backup_mode" and the banner explaining
-- why their saves are failing is the one thing that does not render.
grant select on public.system_backup_mode to authenticated;

drop policy if exists read_backup_mode on public.system_backup_mode;
create policy read_backup_mode on public.system_backup_mode
  for select using (auth.role() = 'authenticated');

-- No write policy on purpose. All writes go through the SECURITY DEFINER
-- functions below, which carry their own admin check, so there is exactly
-- one way to change this row.

-- ---------------------------------------------------------------------------
-- Is the freeze on right now?
-- ---------------------------------------------------------------------------

create or replace function public.is_backup_mode_active()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  -- expires_at is part of the condition, not a separate cleanup job: an
  -- expired freeze is simply not active, so nothing has to run for the
  -- school to get its database back.
  select coalesce(
    (select active and expires_at is not null and expires_at > now()
       from public.system_backup_mode where id),
    false
  );
$$;

comment on function public.is_backup_mode_active() is
  'True while a backup freeze is in force. Expiry is evaluated on read, so a freeze can never outlive its deadline.';

-- ---------------------------------------------------------------------------
-- The guard itself
-- ---------------------------------------------------------------------------

create or replace function public.enforce_backup_mode()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  -- Escape hatch first, and before any table read, so that a superuser can
  -- always get in even if something below is broken.
  if session_user in ('postgres', 'supabase_admin') then
    return null;
  end if;

  if not public.is_backup_mode_active() then
    return null;
  end if;

  -- The admin who started the freeze keeps writing: they are the one holding
  -- the admin page open, and they may be the one fixing whatever prompted
  -- the backup in the first place.
  if exists (
    select 1 from public.system_backup_mode
     where id and started_by is not null and started_by = auth.uid()
  ) then
    return null;
  end if;

  raise exception
    using errcode = 'read_only_sql_transaction',
          message = 'The system is in backup mode, so changes are paused while a backup is taken.',
          hint    = 'This clears on its own within the hour. Try again in a few minutes, or ask an admin.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Attach the guard to every table in public
-- ---------------------------------------------------------------------------

create or replace function public.attach_backup_mode_guard(p_table text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_table = 'system_backup_mode' then
    return;  -- guarding this would make the freeze un-turn-off-able
  end if;
  execute format(
    'drop trigger if exists a_backup_mode_guard on public.%I', p_table);
  execute format(
    'create trigger a_backup_mode_guard before insert or update or delete '
    'on public.%I for each statement execute function public.enforce_backup_mode()',
    p_table);
end;
$$;

do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    perform public.attach_backup_mode_guard(t.tablename);
  end loop;
end;
$$;

-- New tables added by later migrations must not silently escape the freeze —
-- a backup-mode guard with a hole in it is worse than none, because it is
-- trusted. This picks them up automatically.
create or replace function public.guard_new_tables()
returns event_trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands()
  loop
    if obj.object_type = 'table' and obj.schema_name = 'public' then
      perform public.attach_backup_mode_guard(split_part(obj.object_identity, '.', 2));
    end if;
  end loop;
end;
$$;

drop event trigger if exists guard_new_tables_trigger;
create event trigger guard_new_tables_trigger
  on ddl_command_end when tag in ('CREATE TABLE')
  execute function public.guard_new_tables();

-- ---------------------------------------------------------------------------
-- Start / end, the only supported way to change the row
-- ---------------------------------------------------------------------------

create or replace function public.start_backup_mode(
  p_reason  text default null,
  p_minutes integer default 30
)
returns public.system_backup_mode
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare result public.system_backup_mode;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can put the system into backup mode.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A freeze with no deadline, or an absurd one, is how a school loses a
  -- day of data entry. Cap it: a dump of this database takes ~90 seconds.
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'Backup mode must expire between 1 and 60 minutes from now (got %).', p_minutes
      using errcode = 'invalid_parameter_value';
  end if;

  update public.system_backup_mode
     set active        = true,
         started_at    = now(),
         started_by    = auth.uid(),
         expires_at    = now() + make_interval(mins => p_minutes),
         reason        = p_reason,
         run_reference = null,
         updated_at    = now()
   where id
  returning * into result;

  return result;
end;
$$;

create or replace function public.end_backup_mode()
returns public.system_backup_mode
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare result public.system_backup_mode;
begin
  -- Any admin, not just the one who started it: the rescue path matters more
  -- than tidy ownership.
  if not public.is_admin() then
    raise exception 'Only an admin can take the system out of backup mode.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.system_backup_mode
     set active     = false,
         expires_at = null,
         updated_at = now()
   where id
  returning * into result;

  return result;
end;
$$;

-- Lets the admin page show a link to the GitHub Actions run it kicked off.
create or replace function public.set_backup_run_reference(p_reference text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can record a backup run reference.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.system_backup_mode
     set run_reference = p_reference, updated_at = now()
   where id;
end;
$$;

revoke all on function public.start_backup_mode(text, integer) from public;
revoke all on function public.end_backup_mode() from public;
revoke all on function public.set_backup_run_reference(text) from public;
grant execute on function public.start_backup_mode(text, integer) to authenticated;
grant execute on function public.end_backup_mode() to authenticated;
grant execute on function public.set_backup_run_reference(text) to authenticated;
grant execute on function public.is_backup_mode_active() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Visibility: let an admin see the backups that exist
-- ---------------------------------------------------------------------------
--
-- The db-backups bucket is private and carries no storage.objects policies,
-- so the anon key cannot list it — by design, since the tarballs hold every
-- student's personal data. But "is the backup regime actually working?" is a
-- question the admin page has to be able to answer without anyone opening the
-- Supabase dashboard. This exposes the file listing only: names, sizes and
-- timestamps, never the contents, and only to an admin.

create or replace function public.recent_db_backups(p_limit integer default 20)
returns table (name text, created_at timestamptz, size_bytes bigint)
language sql
stable
security definer
set search_path to 'public', 'storage', 'pg_temp'
as $$
  select o.name,
         o.created_at,
         (o.metadata->>'size')::bigint
    from storage.objects o
   where o.bucket_id = 'db-backups'
     and public.is_admin()
   order by o.created_at desc
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.recent_db_backups(integer) from public;
grant execute on function public.recent_db_backups(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Register the page
-- ---------------------------------------------------------------------------
--
-- hasAccess() lets any admin through regardless of this row, so the tile
-- appears without it. It is registered anyway so /admin/permissions lists it
-- alongside everything else — a page that cannot be seen on the permissions
-- screen is a page nobody remembers to review. No role_permissions grant is
-- seeded: taking the school read-only should stay with admins until someone
-- deliberately widens it.

insert into public.resources (resource_key, label, section, sort_order)
values ('/admin/backup', 'Run a Backup', 'Administration', 90)
on conflict (resource_key) do nothing;
