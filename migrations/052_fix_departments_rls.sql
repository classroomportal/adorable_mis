-- Migration 052: departments table was missing RLS policies (migration 051
-- forgot to enable RLS + add a select policy, unlike roles/resources).
-- Without a policy, RLS-enabled-by-default silently returns zero rows
-- instead of erroring, which is why the Department dropdown showed nothing.

alter table departments enable row level security;

create policy "departments readable by all authenticated" on departments
  for select using (auth.role() = 'authenticated');

create policy "departments editable by admin" on departments
  for all using (is_admin()) with check (is_admin());
