-- 169_email_functions_key_from_vault.sql
-- Every function that calls the send-workspace-email edge function used to
-- carry the project's anon key as a literal in its body ('Bearer eyJ...'),
-- copied from migration to migration. 167 and 168 moved the detention email
-- and the behaviour alert to read it from Supabase Vault
-- ('send_workspace_email_key'); this does the same for the rest:
--   send_staff_welcome_email, send_student_welcome_email,
--   parent_welcome_email_post, send_message.
-- One place to rotate the key, and no more copies of it in function bodies.
--
-- The rewrite happens inside the database: each live function definition
-- has its one 'Bearer <literal>' swapped for a call to
-- send_workspace_email_key(), and is re-created with create or replace, so
-- owner, grants, search_path and everything else in the body stay exactly as
-- they are. That also keeps the key out of this file. It rewrites whatever
-- public function still has a literal, so it is safe to re-run, and ends by
-- checking none is left.
--
-- If the Vault secret is ever missing the header becomes 'Bearer ' and the
-- edge function rejects the call; the calling transaction (a message send, a
-- welcome email) still completes, as pg_net is fire-and-forget.

create or replace function public.send_workspace_email_key()
returns text
language sql
stable
security definer
set search_path = pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'send_workspace_email_key';
$$;

revoke execute on function public.send_workspace_email_key() from public, anon, authenticated;

do $$
declare
  f record;
  v_def text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ '''Bearer eyJ[A-Za-z0-9._-]+'''
  loop
    v_def := regexp_replace(
      pg_get_functiondef(f.oid),
      '''Bearer eyJ[A-Za-z0-9._-]+''',
      '''Bearer '' || coalesce(public.send_workspace_email_key(), '''')',
      'g'
    );
    execute v_def;
    raise notice 'Key now read from Vault in %', f.proname;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and pg_get_functiondef(p.oid) ~ 'Bearer eyJ'
  ) then
    raise exception 'A public function still has a literal send-workspace-email key';
  end if;
end;
$$;
