-- Migration 402: a guidance role that works the Worry Box with the DSL and
-- the principal.
--
-- Why (the principal, 8 Oct 2026): "worry box needs to be viewable by our
-- guidance personnel and we need a new role to allow this", after 16 urgent
-- worries sat unopened overnight with only the DSL and the principal able to
-- read them.
--
--   * New role `guidance` (Guidance & Counselling). Like `dsl`, it isn't on
--     the Staff Roles page: who holds it is set in a migration agreed with
--     the principal, so HR or an admin can't hand out access to students'
--     worries.
--   * can_see_worry_box() = can_read_worries() (dsl, principal) or the
--     guidance role, checked on the roles themselves, so admin is not enough.
--     It replaces can_read_worries() in the two Worry Box read policies and
--     the Worry Box functions (open_worry, add_worry_note, set_worry_status,
--     record_paper_worry, worry_box_counts): guidance staff read every worry
--     with the student's name, open, note, reply, close and type in paper
--     slips, exactly as the DSL and the principal do.
--   * The wellbeing check-in and the school rating keep can_read_worries():
--     the DSL and the principal only.
--   * The page /worry-box is granted to the role. Students are told who reads
--     their worries (the Worry Box tile now says the guidance staff too).

set local formwork.change_note = 'Principal (direct)';

insert into public.roles (role_name, description) values
  ('guidance', 'Guidance & Counselling: reads and follows up the Worry Box with the DSL and the principal')
on conflict (role_name) do nothing;

create or replace function public.can_see_worry_box()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select can_read_worries() or holds_staff_role('guidance');
$$;

revoke execute on function public.can_see_worry_box() from public, anon;
grant execute on function public.can_see_worry_box() to authenticated;

alter policy worries_dsl_read on public.worries using ((select can_see_worry_box()));
alter policy worry_notes_dsl_read on public.worry_notes using ((select can_see_worry_box()));

-- The same functions, with the wider check.
do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('open_worry', 'add_worry_note', 'set_worry_status', 'record_paper_worry', 'worry_box_counts')
  loop
    v_def := pg_get_functiondef(f.oid);
    if position('can_read_worries()' in v_def) > 0 then
      execute replace(replace(v_def, 'can_read_worries()', 'can_see_worry_box()'),
                      'Only the DSL and the principal', 'Only the DSL, the principal and guidance staff');
    end if;
  end loop;
end $$;

insert into public.role_permissions (role_name, resource_key) values ('guidance', '/worry-box')
on conflict do nothing;
