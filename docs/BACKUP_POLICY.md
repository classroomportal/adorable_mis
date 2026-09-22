# Backup policy

How Formwork's database is backed up, how long copies are kept, and what to do
when something goes wrong. Written to be followed by whoever is on duty, not
only by whoever built it.

Wherever this document states a number, that number is also set in code — the
retention tiers live in `scripts/prune-backups.sh`, the schedule in
`.github/workflows/nightly-backup.yml`. Change both together, or the policy
becomes fiction.

## Why this exists at all

The Supabase organisation is on the Free plan, which includes **no automatic
database backups** — not a daily one, and certainly not point-in-time recovery.
Everything below is a DIY safety net. If the school moves to Supabase Pro, PITR
becomes available and this regime should be reviewed rather than simply kept.

## What is backed up

A full logical dump of the Postgres database: roles, schema, and all data,
produced by the Supabase CLI (whose bundled `pg_dump` matches the project's
Postgres version). Packaged as `backup-<UTC timestamp>.tar.gz` containing
`roles.sql`, `schema.sql` and `data.sql`.

**Not** backed up by this process:

- Files in Supabase Storage other than the backups themselves — student photos,
  uploaded documents. If those matter, they need their own job.
- Supabase project configuration: auth settings, API keys, edge functions,
  cron jobs. These are not in the dump and would need recreating by hand.

## When it runs

| Trigger | Schedule | Who starts it |
|---|---|---|
| Nightly | `0 1 * * *` — 01:00 UTC, 02:00 Lagos | GitHub Actions |
| On demand | Any time | An admin, via **Administration → Run a Backup** |

The nightly cron is the **earliest** GitHub will consider running the job, not a
promise. Scheduled runs queue on shared runners and have in practice been
starting around 06:50–07:30 UTC. Do not treat a backup that has not appeared by
03:00 Lagos as a failure; treat one that has not appeared by mid-morning as one.

## Retention schedule

Applied after every successful upload by `scripts/prune-backups.sh`:

| Tier | Kept | Rationale |
|---|---|---|
| Daily | Every backup for **14 days** | Covers the errors you notice within a fortnight — a bad import, a dropped table |
| Weekly | **Sunday's** backup for **8 weeks** | Covers the half-term-scale mistake |
| Monthly | The **1st of the month** for **12 months** | Covers data errors only discovered when reports are pulled, often a term later |

Roughly 33 files, a few hundred MB.

The reasoning behind tiers rather than a flat window: a 14-day window only
protects against errors somebody spots inside 14 days. A wrong grade boundary
applied in September, noticed when reports go out in December, is unrecoverable
under a flat window — every surviving backup already contains the error.

Two deliberate safety behaviours in the prune script:

- A file whose name it cannot parse is **kept**, never deleted. An unexpected
  filename is a reason to look, not a reason for a script to throw a backup away.
- If the rules would delete *everything*, it refuses and exits non-zero. That
  outcome is a bug in the settings, not a tidy bucket.

## Where backups are held, and who can read them

The private `db-backups` Supabase Storage bucket, in the same project as the
live database. The bucket is `public = false` with no `storage.objects`
policies for `anon` or `authenticated`, so only the `service_role` key used by
the workflow can read, write or prune it.

**These files contain personal data for every student, parent and member of
staff** — names, dates of birth, contact details, pastoral and behaviour
records, fee information. Anyone who can read the bucket can reconstruct the
whole MIS. Treat the service-role key and any downloaded tarball accordingly:
do not put one on a personal laptop, in email, or in a shared drive without
deciding first who can reach it.

Admins can see the *list* of backups (names, sizes, timestamps — never
contents) at **Administration → Run a Backup**, via the `recent_db_backups()`
function.

### Known gap: single provider

The backups live inside the very Supabase project they protect. This covers a
bad migration, an accidental delete, or a corrupted table. It does **not** cover
losing the project itself — a billing lapse, an org-level mistake, a compromised
account. An off-site copy to the school's Google Workspace was built and set
aside (commit `45ca9bb`); until something like it is in place, this remains the
regime's weakest point and should be stated plainly to anyone asking how well
protected the school's data is.

## Backup mode

Before anything risky — an end-of-year rollover, a bulk import, a large data
correction — an admin can take a backup with the system frozen, so the resulting
file is a restore point with nothing written to it part-way through.

**Administration → Run a Backup** does three things in order: puts the database
into backup mode, triggers the same workflow that runs nightly, then lifts the
freeze. While it is on, staff can read everything and save nothing, and see a
banner saying so.

The freeze is enforced in Postgres (migration 117), not in the app, because
pages talk to Supabase directly from the browser and a UI-level freeze is a
courtesy a stale tab ignores.

**It cannot strand the school.** Four independent ways out:

1. The freeze carries an expiry (15 minutes from the tile, 60 maximum) and is
   evaluated on read, so it lifts itself with nothing needing to run.
2. Any admin can end it, not just the one who started it.
3. The admin who started it is never frozen out.
4. Superuser sessions — the Supabase SQL editor — are exempt unconditionally.

If staff report that saving is broken and no backup is running, check
`select * from system_backup_mode;` and call `select end_backup_mode();`.

## Routine checks

| How often | What | Who |
|---|---|---|
| Weekly | Open **Run a Backup** and confirm there is a backup from last night, of a plausible size | Admin |
| Termly | **Do a restore test** (below). A backup nobody has restored is a hypothesis | Admin |
| Annually | Re-read this document: are the tiers still right, has the Supabase plan changed, is the off-site gap still open? | Admin |

A sudden drop in backup size is the signal worth watching. A file that is
suddenly half the size of yesterday's usually means a dump that failed part-way
but still uploaded.

## Restore test

Do this termly, and never for the first time during an actual emergency.

1. Create a **new, empty** Supabase project (or a branch). Never restore into
   production as a test.
2. Download the most recent backup and `tar xzf` it.
3. Apply, in this order:
   ```
   psql "$DB_URL" -f roles.sql
   psql "$DB_URL" -f schema.sql
   psql "$DB_URL" -f data.sql
   ```
4. Check a handful of things that would reveal a partial restore: student count,
   a recent behaviour event, a timetable row, a fee balance.
5. Write down how long the whole thing took. That number is the school's real
   recovery time, and it is the only honest answer when a governor asks.
6. Delete the test project.

## When a backup fails

1. **Check whether it is really failing.** A nightly run that has not appeared by
   09:00 Lagos is late; the GitHub Actions run log says which step failed.
2. **Common causes**, in the order they have actually happened here:
   - `SUPABASE_DB_URL` set to the direct connection string rather than the
     transaction pooler. GitHub runners have no IPv6 and direct connections are
     IPv6-only, so this fails with "Network is unreachable".
   - An expired or rotated `SUPABASE_SERVICE_ROLE_KEY`.
   - GitHub disabling scheduled workflows after 60 days without repository
     activity.
3. **Take a manual backup immediately** via the admin tile — do not wait for the
   cause to be found. The gap in cover matters more than the diagnosis.
4. **Do not let two consecutive nights fail silently.** Two is the point at
   which this stops being a glitch and starts being an unprotected school.

## Restoring for real

Restoring overwrites live data and is not reversible. Before starting:

- Put the system into backup mode and take a fresh backup of the *current*
  broken state. You may need to get something out of it later.
- Work out what will be lost: everything entered between the backup's timestamp
  and now. Tell whoever will be affected before you do it, not after.
- Prefer restoring into a fresh database and copying across the specific rows
  you need, over restoring wholesale into production. Wholesale is for total
  loss, not for fixing a bad import.
