-- Migration 163: fix "UPDATE requires a WHERE clause" on the tuckshop
-- Open / Close Ordering page.
--
-- set_tuckshop_ordering() (migration 120) updated the system_settings
-- singleton with no WHERE clause. Supabase runs API requests with the
-- pg-safeupdate extension loaded, which rejects any UPDATE or DELETE without
-- a WHERE — including one inside a SECURITY DEFINER function called over
-- RPC. So every click on "Close ordering" / "Reopen ordering now" failed.
-- It went unnoticed because the closures so far (migrations 119, 161) were
-- set from the SQL editor, which doesn't load safeupdate.
--
-- system_settings is a one-row table keyed by id = true, so targeting that
-- row is exactly what the unfiltered update meant. Otherwise identical to 120.

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
      updated_at = now()
  where id = true;

  return p_closed_until;
end;
$function$;
