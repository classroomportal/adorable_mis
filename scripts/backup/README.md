# Backup protocol — Adorable MIS

Written ahead of go-live because of one fact worth stating plainly:

**This Supabase project (`adorable_mis`, org "Adorable Maths") is on the Free
plan.** Checked directly via the Supabase connector on 2026-09-17. Free-plan
projects get **no automatic backups and no point-in-time recovery from
Supabase at all** — that's a Pro-plan feature (daily backups, 7-day
retention) and above. Right now, if the database is damaged — a bad bulk
edit, a bug in a migration, an accidental `DELETE`, a compromised account —
there is *nothing* to restore from except what we build ourselves. This
protocol is that.

It follows the standard 3-2-1 shape: **3** copies of the data (production +
this Mac + Google Drive), on **2** different media (local disk + cloud), with
**1** copy offsite (Google Drive, off this Mac entirely).

**Strongly recommend alongside this:** upgrading the Supabase org to the Pro
plan (~$25/mo) once the school is paying for this to be live. It buys
independent, vendor-side daily backups that don't depend on this Mac, this
script, or anyone remembering to run it — genuinely worth it for a system
holding real student medical notes and national ID numbers. This DIY
protocol is still worth having even with Pro, since it's a copy outside
Supabase's own infrastructure — but Pro removes the single point of failure
of "the principal's laptop."

## What's backed up, and what isn't

The backup dumps the **`public` schema only**, in Postgres's custom
(`-Fc`) format. That one file contains, restorable as a unit:

- Every table's data — students, parents, results, behaviour, attendance,
  fees, tuckshop, messages, the lot (see `sql/CURRENT_SCHEMA.md` for the
  full list of 61 tables).
- Every view, function, and trigger defined in `public` (RLS policies
  included — Postgres treats them as regular catalog objects `pg_dump`
  captures automatically).

**Deliberately excluded:**

- **`auth.users` / `auth.identities`** (login credentials). See "Why auth
  isn't in the dump" below — this is intentional, not an oversight.
- **Supabase-managed internal schemas** (`vault`, `cron`, `net`,
  `extensions`, `realtime`, `graphql`, `supabase_migrations`, `pgbouncer`,
  etc.). These are infrastructure Supabase itself manages; dumping and
  restoring them across projects is unsupported and typically breaks. The
  two pg_cron jobs (`capture-register-alerts`, `reset-demo-data-nightly`)
  and the `resend_api_key` Vault secret are two-line, already-documented
  things to re-add by hand if you're ever rebuilding a project from
  scratch — see `sql/CURRENT_SCHEMA.md`.
- **Student photos are covered automatically** — they're stored as
  base64 text directly in `students.photo_base64`, not in a separate
  Supabase Storage bucket, so the `public` schema dump already includes
  them. (Worth re-checking this note if the app ever moves photos to
  Storage.)

### Why auth isn't in the dump

Restoring Supabase's internal `auth` schema into a *different* project
(the disaster-recovery case where the original project is gone) is fragile
and not something Supabase supports well. This codebase already has a
better answer: `create_staff_logins()`, `create_parent_logins()`, and
`create_student_logins()` (see `sql/CURRENT_SCHEMA.md`) regenerate fresh
`auth.users` + `profiles` rows straight from the `staff` / `parents` /
`students` tables, with new temporary passwords. So after restoring the
business data, logins are one function call away — no fragile cross-project
auth restore needed. The tradeoff: after a full rebuild, everyone gets a new
temporary password and has to log in again. That's an acceptable cost for
what should be a rare, catastrophic scenario.

For the common case — restoring into the *same*, still-working project
after an accidental bad edit — `auth.users` was never touched, so this
doesn't come up at all; see Scenario A below.

## One-time setup (do this before the weekend)

1. **Install the Postgres client tools** (for `pg_dump`/`pg_restore`) and
   `gpg` on your Mac:
   ```
   brew install libpq gnupg
   brew link --force libpq
   ```
2. **Get the database connection string.** Supabase Dashboard → `adorable_mis`
   project → Project Settings → Database → Connection string. Copy
   `backup.env.example` to `backup.env` in this folder and paste it into
   `SUPABASE_DB_URL`. Read the comment above it in `backup.env.example` about
   the IPv4/IPv6 gotcha on the Free plan — if the direct connection times out,
   use the "Connection pooling" (Session mode, port 5432) string instead.
3. **Set up encryption for the cloud copy.** This data includes medical
   notes, national identity numbers, home addresses and parent phone
   numbers — don't put it in Google Drive unencrypted. Pick a strong,
   memorable passphrase and store it in the Mac's Keychain so the script can
   use it unattended:
   ```
   security add-generic-password -a "$(whoami)" -s "AdorableMIS-BackupPassphrase" -w
   ```
   (it will prompt you for the passphrase rather than taking it on the
   command line). **Also write this passphrase down somewhere durable and
   offline** (a password manager entry, a sealed envelope in a safe) — if
   this Mac is lost and the Keychain goes with it, the passphrase is the
   only way to open the Google Drive backups from anywhere else.
4. **Point at your Google Drive folder.** Install/sign in to Google Drive
   for Desktop with the school Google account, create a folder such as
   `AdorableMIS-Backups (Encrypted)` inside "My Drive", and set
   `CLOUD_BACKUP_DIR` in `backup.env` to its path under
   `~/Library/CloudStorage/`. **Restrict sharing on that Drive folder** to
   people who should already see this data (you, whoever else administers
   the system) — don't leave it link-shareable.
5. **Test it by hand first:**
   ```
   chmod +x scripts/backup/backup_supabase.sh scripts/backup/restore_supabase.sh
   ./scripts/backup/backup_supabase.sh
   ```
   Confirm a `.dump` file appears in `~/AdorableMIS-Backups` and an
   encrypted `.dump.gpg` appears in the Google Drive folder (check
   drive.google.com from a browser, not just the local Finder sync, to
   confirm it actually uploaded).
6. **Schedule it.** Copy
   `org.classroomportal.adorablemis.backup.plist.example` to
   `~/Library/LaunchAgents/org.classroomportal.adorablemis.backup.plist`,
   replace `YOUR_USERNAME` with the output of `whoami`, then:
   ```
   launchctl load ~/Library/LaunchAgents/org.classroomportal.adorablemis.backup.plist
   ```
   It runs daily at 23:00 while you're logged in. If this Mac is regularly
   shut down overnight, pick a different hour in the plist, or just get in
   the habit of running the script by hand before you close the lid.

## Restoring

There are two very different scenarios — read which one you're in before
doing anything.

### Scenario A: "someone broke the data, the project is fine" (the common case)

A bad bulk edit, an accidental delete, a migration that went wrong — the
Supabase project itself is healthy, `auth.users` is untouched, you just need
older data back.

```
./scripts/backup/restore_supabase.sh ~/AdorableMIS-Backups/adorable_mis_2026-09-19_230000.dump students
```

Prefer naming a single affected table (last argument) over restoring the
whole schema — it's much harder to make things worse that way, and it
won't clobber same-day changes in unrelated tables (new results entered
this morning, say). Restoring the *whole* schema rolls back **everything**
to backup time, including tables nobody broke — only do that if you're sure
that's what's needed.

### Scenario B: rebuilding in a new project (rare, catastrophic)

The Supabase project itself is gone, deleted, or otherwise unrecoverable.
This is bigger than running a script:

1. Recreate the schema structure (tables, RLS, functions, triggers) — the
   most complete record of this is a fresh `public`-schema-only dump
   itself (it contains full `CREATE TABLE`/`CREATE POLICY`/`CREATE
   FUNCTION` statements, not just data), so restoring the `.dump` file into
   a brand-new, empty Supabase project's `public` schema rebuilds
   structure and data together. `sql/CURRENT_SCHEMA.md` is the
   human-readable cross-check if anything looks off.
2. **Before restoring the `profiles` table**, know that its rows point at
   `auth.users` IDs that won't exist in the new project. Either exclude
   `profiles` from this restore pass, or restore it and then truncate it —
   either way, don't expect old logins to work yet.
3. Re-run `create_staff_logins()`, `create_parent_logins()`, and
   `create_student_logins()` (via the Supabase SQL editor, or ask Claude to
   run them via the Supabase connector) to regenerate `auth.users` +
   `profiles` with fresh temporary passwords, and get those passwords back
   out to staff/parents/students.
4. Manually re-add the two pg_cron jobs and the `resend_api_key` Vault
   secret — both are documented in `sql/CURRENT_SCHEMA.md`.

This isn't something to script blind — treat it as a guided rebuild, not a
button to press.

## Maintenance

- **Test-restore monthly**, not just when something breaks. An unverified
  backup is a hope, not a backup. Restoring into a Supabase branch (if the
  plan supports branching) or a throwaway local Postgres is enough — you're
  checking the file is valid and the process still works, not fixing
  production.
- **Retention** defaults to 30 days locally and in Google Drive
  (`RETENTION_DAYS` in `backup.env`) — old backups are deleted
  automatically by the script. Raise it if you want a longer paper trail;
  every extra day is another day of PII sitting in more places, so don't
  raise it casually.
- If `backup_supabase.sh` ever logs a warning about copying **unencrypted**
  to Google Drive, stop and fix the Keychain passphrase setup (step 3)
  before the next run — don't let PII accumulate there in the clear.
