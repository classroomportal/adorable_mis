-- Migration 120: let tuckshop staff open and close ordering from the app,
-- instead of it needing a hand-written UPDATE in the SQL editor.
--
-- Migration 119 added system_settings.tuckshop_ordering_closed_until and the
-- tuckshop_ordering_closed() guard, but left the only way to change it as raw
-- SQL. This adds the /tuckshop/ordering page behind it.
--
-- Why an RPC rather than letting the page write system_settings directly:
-- that table's write policy is is_admin() only, and system_settings also
-- holds parent_emails_paused — the system-wide block on emailing parents from
-- migration 114. Widening the table policy to tuckshop/bursar would hand
-- those roles the parent-email switch as well. A SECURITY DEFINER function
-- that touches only the two tuckshop columns gives them exactly the control
-- they need and nothing else.
--
-- A past reopen date is rejected rather than quietly stored: closed_until in
-- the past reads as "open" to tuckshop_ordering_closed(), so accepting it
-- would tell staff ordering was shut when it was still running.

create or replace function set_tuckshop_ordering(p_closed_until date, p_note text default null)
returns date
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if not (is_admin() or user_has_staff_role(array['tuckshop', 'bursar'])) then
    raise exception 'Only tuckshop, bursar or admin staff can open or close tuckshop ordering';
  end if;

  if p_closed_until is not null and p_closed_until <= v_today then
    raise exception 'Reopen date must be after today (%). To reopen now, clear the date instead.', v_today;
  end if;

  update system_settings
  set tuckshop_ordering_closed_until = p_closed_until,
      tuckshop_ordering_closed_note = p_note,
      updated_at = now();

  return p_closed_until;
end;
$function$;

comment on function set_tuckshop_ordering(date, text) is
  'Open or close student tuckshop preordering. Pass a reopen date to close until then, or null to reopen now. Writes only the tuckshop columns of system_settings.';

-- The page itself, alongside the other Tuckshop entries (sort_order 80-84).
insert into resources (resource_key, label, section, sort_order)
values ('/tuckshop/ordering', 'Open / Close Ordering', 'Tuckshop', 85)
on conflict (resource_key) do update set
  label = excluded.label,
  section = excluded.section,
  sort_order = excluded.sort_order;

-- Same roles that already hold Sell Items / Items & Prices. Houseparent is
-- deliberately left out: it holds Preorders (read) but does not run the shop.
insert into role_permissions (role_name, resource_key)
select r, '/tuckshop/ordering' from unnest(array['admin', 'bursar', 'tuckshop']) as r
on conflict do nothing;
