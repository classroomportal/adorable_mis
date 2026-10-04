-- ============================================
-- Migration 360: parents see a mark only after a delay set on Lookups
--
-- Why: teachers enter ReLPs and Teacher Assessments during the week, and
-- wrong numbers have reached families before anyone noticed (the reason for
-- mark appeals, migration 354). The principal (4 Oct 2026) asked for marks to
-- reach parents some hours after they are entered, with the number of hours
-- editable on /admin/lookups rather than fixed.
--
-- How:
--  * system_settings.parent_result_delay_hours (0-168). 0 = no delay, which
--    is where it starts, so nothing changes until someone sets it.
--  * parent_read_own_results only returns a mark once results.created_at is
--    that many hours old. The clock starts when the mark is first entered; a
--    later correction doesn't restart it, so a mark a parent has already seen
--    never disappears for a day after it is fixed.
--  * created_at is pinned by trigger (now() on insert, unchanged on update),
--    so a page or a copied request can't backdate a mark past the delay.
--  * Students and staff are unaffected: students still see their own marks
--    at once, which gives them the delay to appeal before parents see it.
--  * Saved only through set_parent_result_delay() (Lookups holders, like
--    set_grade_appeal_rules()).
-- ============================================

set local formwork.change_note = 'Principal (direct)';

alter table public.system_settings
  add column if not exists parent_result_delay_hours integer not null default 0
  constraint system_settings_parent_result_delay_check
    check (parent_result_delay_hours between 0 and 168);

-- Read by the parent policy. system_settings is readable by every signed-in
-- user anyway; this just keeps the policy short.
create or replace function public.parent_result_delay_hours()
returns integer
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select parent_result_delay_hours from system_settings where id), 0);
$$;
revoke execute on function public.parent_result_delay_hours() from public, anon;
grant execute on function public.parent_result_delay_hours() to authenticated;

create or replace function public.set_parent_result_delay(p_hours integer)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not has_resource_access('/admin/lookups') then
    raise exception 'Only staff with the Lookups page can change when parents see marks.';
  end if;
  if p_hours is null or p_hours < 0 or p_hours > 168 then
    raise exception 'The delay must be between 0 and 168 hours (one week).';
  end if;
  update system_settings set parent_result_delay_hours = p_hours, updated_at = now() where id;
end;
$$;
revoke execute on function public.set_parent_result_delay(integer) from public, anon;
grant execute on function public.set_parent_result_delay(integer) to authenticated;

-- created_at is when the delay starts, so the app can't choose it.
create or replace function public.results_pin_created_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace trigger trg_results_pin_created_at
  before insert or update on public.results
  for each row execute function public.results_pin_created_at();

-- Same rule as before (the student_parent join keeps migration 255's
-- current-children-only rule through that table's own policy), plus the delay.
-- alter, not drop and recreate: the Supabase connector holds back a drop.
alter policy parent_read_own_results on public.results
  using (
    exists (
      select 1
      from profiles p
      join student_parent sp on sp.parent_id = p.parent_id
      where p.id = auth.uid() and sp.student_id = results.student_id
    )
    and results.created_at <= now() - make_interval(hours => (select public.parent_result_delay_hours()))
  );
