-- Migration 173: turn the parent-email pause on and off from the page.
--
-- Why: the pause (migration 114) could only be changed by running
-- `update system_settings set parent_emails_paused = ...` in the SQL editor.
-- /parents/welcome-emails now has a switch for it. The pause covers every
-- email to a parent — welcome letters (send_parent_welcome_email,
-- send_parent_welcome_batch, create_parent_login) and individual messages
-- (send_message) — so the switch says so.
--
-- A function rather than a direct update from the page, same as
-- set_tuckshop_ordering(): it stamps who changed it and when into the note
-- the page shows, and system_settings updates need a WHERE clause (see
-- migration 170).

create or replace function public.set_parent_emails_paused(p_paused boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_who text;
  v_stamp text;
begin
  if not is_admin() then
    raise exception 'Only admin can pause or resume parent emails' using errcode = 'insufficient_privilege';
  end if;

  select nullif(trim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')), '')
    into v_who
  from profiles pr left join staff s on s.staff_id = pr.staff_id
  where pr.id = auth.uid();

  v_stamp := case when p_paused then 'Paused' else 'Resumed' end
    || ' ' || to_char(school_now(), 'FMDD Mon YYYY, HH24:MI')
    || coalesce(' by ' || v_who, '');

  update system_settings
     set parent_emails_paused = p_paused,
         parent_emails_paused_note = v_stamp || coalesce(' — ' || nullif(trim(p_note), ''), ''),
         updated_at = now()
   where id = true;
end;
$$;

revoke execute on function public.set_parent_emails_paused(boolean, text) from public, anon;
grant execute on function public.set_parent_emails_paused(boolean, text) to authenticated;
