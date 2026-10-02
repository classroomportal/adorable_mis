-- Migration 327: let /admin/permissions show what each role can actually do.
--
-- Why (the principal, 2 Oct 2026): the Permissions page lists which pages a
-- role can open, but what the role can view, add, edit or delete is decided
-- by the Row Level Security policies on each table, which had no screen
-- anywhere (only sql/RLS_ACCESS_SUMMARY.md, a hand-made snapshot). So the
-- page didn't reflect what a person with a role could really do.
--
-- These two read-only functions hand the page the live rules: every policy
-- on a public table (its condition as Postgres stores it) and, per table,
-- whether the app's role has been granted each action at all. The page
-- (lib/roleAbilities.js) judges each condition for the chosen role. Nothing
-- here changes who can do what.
--
-- Only someone who can open /admin/permissions may call them: policy text
-- names helper functions and rules, which is no business of other users.

set local formwork.change_note = 'Principal (direct)';

create or replace function public.role_access_policies()
returns table (
  table_name text,
  policy_name text,
  cmd text,
  roles text[],
  qual text,
  with_check text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not has_resource_access('/admin/permissions') then
    raise exception 'Only someone with the Permissions page can read access rules';
  end if;
  return query
    select p.tablename::text, p.policyname::text, p.cmd::text, p.roles::text[], p.qual, p.with_check
    from pg_policies p
    where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
    order by p.tablename, p.policyname;
end;
$$;

create or replace function public.role_access_tables()
returns table (
  table_name text,
  rls_enabled boolean,
  can_select boolean,
  can_insert boolean,
  can_update boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not has_resource_access('/admin/permissions') then
    raise exception 'Only someone with the Permissions page can read access rules';
  end if;
  return query
    select c.relname::text, c.relrowsecurity,
      has_table_privilege('authenticated', c.oid, 'select'),
      has_table_privilege('authenticated', c.oid, 'insert'),
      has_table_privilege('authenticated', c.oid, 'update'),
      has_table_privilege('authenticated', c.oid, 'delete')
    from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
    order by c.relname;
end;
$$;

revoke execute on function public.role_access_policies() from public, anon;
revoke execute on function public.role_access_tables() from public, anon;
grant execute on function public.role_access_policies() to authenticated;
grant execute on function public.role_access_tables() to authenticated;
