# Formwork — orientation for Claude

School MIS for Adorable British College (Next.js 14 App Router + Supabase). Live app at `misform.work`, deployed on Vercel. It has a demo account available on it for training (see `staff_demo` under Conventions below).

## Schema: read `sql/CURRENT_SCHEMA.md` before guessing

**A large part of this schema was built directly against the live Supabase instance and was never committed to `sql/` or `migrations/`.** Those two folders are an incomplete, roughly-chronological history — they are not a reliable source of truth for what currently exists. `sql/CURRENT_SCHEMA.md` is a full introspected dump of the live database (tables, columns, RLS policies, triggers, views, functions, extensions, cron jobs), generated 16 September 2026 via the Supabase MCP connector. Check it before assuming a table/view/function doesn't exist, or guessing at its shape — several real incidents this session came directly from not doing that (see that file's intro for specifics: a PII-leaking view, an undocumented trigger that emailed real staff, etc.). Regenerate it (don't hand-edit) when the schema has drifted meaningfully.

`sql/schema.sql` is the *original* bootstrap schema from early in the project — kept for history, not current.

## Getting live database access in a fresh session

There's an official Supabase MCP connector connected to this account (project ref `drjtcegtucovhbyfdpbx`, "adorable_mis"). If its tools (`mcp__Supabase__*`) aren't showing up via `ToolSearch`, it's usually just toggled off for the current chat, not actually disconnected — check `ListConnectors`; if `connected: true` but `enabledInChat: false`, ask the user to flip it on in that chat's connector settings, no need to redo any OAuth. Direct `psql`/raw Postgres connections are blocked by this sandbox's network policy — don't waste time on that path.

When the connector genuinely isn't available, the fallback (used successfully many times this session) is: write the migration as a numbered file under `migrations/`, paste the equivalent raw SQL into the chat in a code block, and have the user run it in the Supabase SQL editor.

## Conventions

- Migrations are numbered sequentially in `migrations/*.sql` (currently up to 086), lowercase SQL, with a comment header explaining *why*, not just what. Follow the existing house style.
- The `staff_demo` training account (`is_demo_account()`, `is_demo` columns) isolates practice data from real data — see migrations 074–086 for the full mechanism, and `sql/CURRENT_SCHEMA.md`'s "Known gaps" section for what it does and doesn't cover yet (Fees/Communication/Reports are still real, unscoped data reachable by direct URL from that account).
- `staff_roles.role_name` values in use: `admin, smt, hr, pastoral, houseparent, assessment_manager, assessment_user, teacher, bursar, school_office, admissions, tuckshop, head_of_department, mentor`. `mentor` is live but not manageable from `/staff/roles` (missing from that page's `ROLE_LABELS`).
- Almost nothing goes through `app/api` — pages talk to Supabase directly from the client. Business logic that needs to be trustworthy lives in Postgres functions/triggers, not in app code.
- When building throwaway spreadsheets/exports for staff (HR rosters, boarding lists, tuckshop prices, etc.), pull live data via the Supabase connector rather than guessing — this repo's actual data has real quirks (placeholder rows, missing house assignments, initials-only names) worth surfacing to whoever asked.

## Running the app locally / building

`npm run build` (or `npx next build`) with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` set — dummy values are fine for a build-only sanity check, real ones are needed to actually load data. `lib/supabaseClient.js` is sometimes swapped for a temporary mock during visual/screenshot testing (via Playwright + the pre-installed Chromium) — always restore it from a backup and verify `git status` is clean afterward before committing.
