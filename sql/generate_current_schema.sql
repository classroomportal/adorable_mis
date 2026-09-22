-- Generates the body of sql/CURRENT_SCHEMA.md.
--
-- CURRENT_SCHEMA.md is an introspected dump of the live database, not a
-- hand-maintained file. These are the exact queries that produce it, kept here
-- so a regeneration is a few copy-pastes rather than a reverse-engineering
-- exercise. Run each section against the live project (Supabase SQL editor or
-- the MCP connector) and paste the single `md` column under the matching
-- heading in the markdown file.
--
-- Two things to know before you regenerate:
--
--   1. Line endings matter. 27 of the functions were originally written with
--      Windows line endings, and pg_get_functiondef reproduces the stored
--      source verbatim, CRs included. The previous snapshots preserved them.
--      If your tooling strips or normalises CRs, the file will differ from the
--      database in a way that is invisible on screen -- check with
--      `grep -c $'\r' sql/CURRENT_SCHEMA.md` (expected: 369 as of this run).
--
--   2. Verify rather than eyeball. Each section below has a matching md5
--      query; take the md5 from the database and compare it against the
--      section as written to the file. That is the only practical way to know
--      a 130KB dump of RLS policies and function bodies copied faithfully:
--
--        section  md5 as of 22 September 2026
--        views    41bfd52a164405d5a704d8bc6420b725
--        tables   d28d960c54525cf1b439639af65c39d9
--        funcs    974e65e9edaacbdfef7f5e9f4a1e62e2
--
-- The header, "Quick facts" and "Known gaps" sections of the markdown file are
-- prose, not generated. Update them by hand; the fact queries at the bottom of
-- this file supply the numbers they quote.


-- ---------------------------------------------------------------------------
-- 1. Views  (paste under "## Views")
-- ---------------------------------------------------------------------------
select string_agg(
         format(E'### `%s`\n```sql\nCREATE VIEW %s AS %s\n```', viewname, viewname, definition),
         E'\n\n' order by viewname) as md
from pg_views where schemaname = 'public';


-- ---------------------------------------------------------------------------
-- 2. Tables  (paste under "## Tables")
--
-- One block per table: columns (PK marked), foreign keys, triggers, RLS
-- policies. Note the policy formatting deliberately omits USING for INSERT
-- policies, where pg_policies leaves qual NULL -- that matches how earlier
-- snapshots rendered them.
-- ---------------------------------------------------------------------------
with t as (
  select c.oid, c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
cols as (
  select t.relname as tbl,
    string_agg(format('| `%s`%s | %s | %s | %s |',
        a.attname,
        case when a.attnum = any (i.indkey_arr) then ' 🔑' else '' end,
        format_type(a.atttypid, a.atttypmod),
        case when a.attnotnull then 'NO' else 'YES' end,
        coalesce(pg_get_expr(d.adbin, d.adrelid), '')),
      E'\n' order by a.attnum) as body
  from t
  join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = t.oid and d.adnum = a.attnum
  left join lateral (
    select array(select unnest(ix.indkey)) as indkey_arr
    from pg_index ix where ix.indrelid = t.oid and ix.indisprimary
  ) i on true
  group by t.relname
),
fks as (
  select t.relname as tbl,
    string_agg(format('`%s` → `%s.%s`',
        (select string_agg(a.attname, ', ' order by x.ord)
         from unnest(con.conkey) with ordinality x(attnum, ord)
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = x.attnum),
        cf.relname,
        (select string_agg(a.attname, ', ' order by x.ord)
         from unnest(con.confkey) with ordinality x(attnum, ord)
         join pg_attribute a on a.attrelid = con.confrelid and a.attnum = x.attnum)),
      ', ' order by con.oid) as body
  from t
  join pg_constraint con on con.conrelid = t.oid and con.contype = 'f'
  join pg_class cf on cf.oid = con.confrelid
  group by t.relname
),
trg as (
  select t.relname as tbl,
    string_agg(format('- `%s`: `%s`', g.tgname, pg_get_triggerdef(g.oid)),
      E'\n' order by g.tgname) as body
  from t join pg_trigger g on g.tgrelid = t.oid and not g.tgisinternal
  group by t.relname
),
pol as (
  select p.tablename as tbl,
    string_agg(format('- `%s` (%s)%s%s',
        p.policyname, p.cmd,
        case when p.qual is not null then ' USING (' || p.qual || ')' else '' end,
        case when p.with_check is not null then ' WITH CHECK (' || p.with_check || ')' else '' end),
      E'\n' order by p.policyname) as body
  from pg_policies p where p.schemaname = 'public'
  group by p.tablename
)
select string_agg(
         format(E'### `%s`\n\n| Column | Type | Nullable | Default |\n|---|---|---|---|\n%s\n%s%s%s',
           t.relname, cols.body,
           coalesce(E'\nForeign keys: ' || fks.body || E'\n', ''),
           coalesce(E'\nTriggers:\n'      || trg.body || E'\n', ''),
           coalesce(E'\nRLS policies:\n'  || pol.body || E'\n', '')),
         E'\n\n' order by t.relname) as md
from t
join cols on cols.tbl = t.relname
left join fks on fks.tbl = t.relname
left join trg on trg.tbl = t.relname
left join pol on pol.tbl = t.relname;


-- ---------------------------------------------------------------------------
-- 3. Functions  (paste under "## Functions (n)")
--
-- prokind = 'f' matters: pg_get_functiondef() errors on aggregates.
-- ---------------------------------------------------------------------------
select string_agg(
         format(E'### `%s(%s)` — %s, %s\n```sql\n%s\n```',
           p.proname,
           pg_get_function_arguments(p.oid),
           case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end,
           l.lanname,
           pg_get_functiondef(p.oid)),
         E'\n\n' order by p.proname, p.oid) as md
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public' and p.prokind = 'f';


-- ---------------------------------------------------------------------------
-- 4. Verification — wrap each of the three queries above in md5(...) and
--    compare against the file. Example, for the functions section:
-- ---------------------------------------------------------------------------
select md5(string_agg(
         format(E'### `%s(%s)` — %s, %s\n```sql\n%s\n```',
           p.proname, pg_get_function_arguments(p.oid),
           case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end,
           l.lanname, pg_get_functiondef(p.oid)),
         E'\n\n' order by p.proname, p.oid)) as md5_functions,
       sum(length(pg_get_functiondef(p.oid))
           - length(replace(pg_get_functiondef(p.oid), chr(13), ''))) as total_carriage_returns,
       count(*) as n
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public' and p.prokind = 'f';


-- ---------------------------------------------------------------------------
-- 5. Facts for the prose sections (counts, extensions, cron, roles, views)
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_tables where schemaname = 'public') as tables,
  (select count(*) from pg_views  where schemaname = 'public') as views,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f') as functions,
  (select count(*) from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal) as triggers,
  (select count(*) from pg_policies where schemaname = 'public') as policies,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity) as rls_tables,
  (select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension) as extensions,
  (select string_agg(distinct role_name, ', ' order by role_name) from staff_roles) as roles_in_use;

select jobname, schedule, command, active from cron.job order by jobname;

-- Which views bypass RLS. A view without security_invoker runs as its owner,
-- which is how student_summary and attendance_today once leaked real student
-- data; check this every regeneration.
select c.relname as view_name,
       coalesce(array_to_string(c.reloptions, ', '), '(none)') as reloptions,
       case when 'security_invoker=true' = any(c.reloptions)
                 or 'security_invoker=on' = any(c.reloptions)
            then 'INVOKER (respects caller RLS)'
            else 'DEFINER (bypasses RLS)' end as effective
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
order by c.relname;
