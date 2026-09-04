# Adorable MIS — Project Update Summary

**Compiled:** 2026-09-03, from all prior chat sessions.
**Purpose:** a single narrative record of what's been built, decided, and left open — for the repo (`docs/`) and for grounding future sessions.

---

## What Adorable MIS is

A bespoke school Management Information System for **Adorable British College (ABC)**, a Nigerian secondary school, ~261 students across Years 7–12. Built from scratch by Chris Terry (principal) working primarily from a phone.

**Stack:** Next.js frontend, Supabase Postgres backend, Vercel hosting, GitHub (`classroomportal/adorable_mis`), custom domain `mis.classroomportal.org`.
**Supabase project ref:** `drjtcegtucovhbyfdpbx`.

---

## Timeline

### 1. Schema design and first build
Started as a plain relational design exercise (students/parents/timetable/behaviour/results), then rebuilt directly as PostgreSQL in Supabase once the project moved from prototype to real deployment. Core tables were created first — students, parents, student_parent, subjects, staff, classes, timetable_slots, student_class, behaviour_events, results — then expanded to 15+ tables including families, periods, attendance, terms, calendar_events, and CAT4/NGRT predictive assessment tables, plus a `profiles` table for auth roles.

Row Level Security was added early, with an `is_admin()` `SECURITY DEFINER` function to avoid the classic recursive-policy bug (a policy on `profiles` that queries `profiles` recurses infinitely — the function bypasses RLS for the role check).

### 2. Separating from the revision portal
The MIS was initially prototyped inside the same Supabase project as "Adorable Maths Walkthrough" (Chris's separate revision portal). Once real student data was involved, the MIS was split into its own dedicated Supabase project for data-safety/GDPR reasons, with the old project's MIS tables identified for cleanup (some overlap in naming, e.g. a `results`/`test_results` collision, required checking column shapes before dropping anything).

### 3. Hosting and domain
Deployed to Vercel, connected to the existing `classroomportal.org` domain via a `mis` subdomain. Namecheap Advanced DNS: CNAME record `mis` → `db4f74f634e0b912.vercel-dns-017.com`. Live at `mis.classroomportal.org`.

### 4. Legacy data import
Two source systems were brought in:
- **Nova-T/SIMS exports** (`TBTRA-F.DAT`, `NOVACURR.TXT`, `NCLASS.DAT`, `YNAMES.DAT`) — primary source for student, timetable, and staff data.
- **CoreSats ODS files** — predictive assessment data (CAT4, NGRT), linked via `TW Unique ID`, which was identified as equivalent to the school's own UPN (Unique Pupil Number) and adopted as the primary linking key across the whole schema.

Student records were expanded well beyond the original design to match real SIMS fields: state of origin, LGA, home town, boarding house/room, sports house, NECO exam number, UTME PIN/profile code, national identity number, admitted letter date, and more.

### 5. Migrations 013–024 — real data load
Timetable data imported: 331 teaching groups, 50 staff, 899 slots, 50 curriculum blocks. Real staff names loaded. Parent/guardian records loaded and linked by UPN (1,515 parents). Assessment data (CAT4/NGRT) loaded.

Key bug found and fixed: timetable slot ordering must be **day-major** (`slot = (day-1)*9 + period`), not period-major — an earlier period-major version was wrong. Also established: curriculum blocks need an `is_compound` flag so Pathway/Vocational blocks are exempt from the one-class-per-block uniqueness constraint, and Mentor Teaching Group code prefix-matching had to be tightened after being too broad.

### 6. Migrations 025–037 — features build-out
A long feature session covering:

- **025–026** — behaviour category and attendance code lookup tables (written, execution paused pending an updated SIMS export)
- **027** — per-period attendance (`attendance_records`/`attendance`, unique per student/date/period) plus an `attendance_today` view so a later-period teacher can see a read-only "today so far" strip for a student (present/absent/late pattern across earlier periods) — designed specifically to support truancy detection
- **028** — `grade_scale` and `target_grades`, CSV importer, red/amber/green comparison against results
- **029** — student photos: `photo_base64` column (chosen over a storage bucket to avoid added complexity), XML bulk importer, per-student upload with client-side canvas resizing to 400px
- **030** — `certificates_awarded`, printable certificates page, live-computed Sat–Fri detention list
- **031** — behaviour alert emails via `pg_net` + Resend, triggered on dual thresholds (single event ≤ −4 points, or weekly Sat–Fri total ≤ −8 points), API key stored in Supabase Vault
- **032** — admin delete policy on `behaviour_events`, `behaviour_appeals` table with student/pastoral RLS
- **033/035** — bulk student and parent login creators writing directly to `auth.users`/`auth.identities`
- **034** — cascade delete on appeal FK, trigger to zero out event points when an appeal is upheld
- **036** — `send_parent_welcome_email` RPC, Parents admin list page, welcome-email sender page
- **037** — `reset_all_parent_passwords()` returning a single TEXT blob (workaround for the Supabase SQL editor's 100-row display cap on mobile) — used to extract and clean a 1,042-row password reset result

App/UI additions in this phase: staff roles table with `is_staff_or_admin()` / `is_pastoral_or_smt()` / `is_assessment_manager()` helper functions; collapsible sections on the student page; simplified nav (dashboard tiles replacing nav links); grouped dashboard homepage; class progress page (`/classes/progress`); student portal (`/portal`); parent portal (`/parent-portal`) with multi-child selector; appeals review page (`/appeals`); change-password page; Staff & Roles admin page with inline-editable roles.

### 7. Per-period attendance visibility (most recent session)
Confirmed and shipped the "today so far" attendance strip: read-only, colour-coded (green/amber/red/grey) badges on later-period registers showing a student's status in earlier periods that day, without letting teachers edit periods they don't own. RLS was set permissive (`using (true)` for select) so any staff member can see the pattern — flagged as worth revisiting if it should be pastoral/SMT-only instead.

### 8. Schema documentation
A full live schema dump was pulled from `information_schema.columns` and turned into `docs/schema-snapshot.md` — 30 tables/views covering all of the above. Chris uploaded it to the repo directly via GitHub's mobile web editor (PAT avoided for that step).

### 9. Weekly results import, grade computation, and Class Progress fix (most recent session)
Built `/results/import-gradebook` to handle the actual weekly gradebook CSV export (wide format, variable subject columns, headers like `"Quiz: Business Studies Exam (Real)"`), replacing the old fixed-column importer (now retired with a redirect). Added `subject_grade_boundaries` (migrations 039/040) — grade cutoffs defined **per subject and per year group**, not one shared scale, since Year 12 uses WAEC A1–F9 and other years use IGCSE A*–G, and different subjects have genuinely different cutoffs. Boundaries are currently seeded placeholder guesses (see `/admin/grade-boundaries`), not confirmed school policy.

Diagnosed and fixed Class Progress (`/classes/progress`) showing no data despite real results/targets existing — three stacked causes: (1) the gradebook importer created duplicate subject rows where its parsed CSV header name didn't exactly match an existing curriculum subject name (e.g. "Business Studies" vs "Business", "MFL (Ng)" vs "Igbo"), fixed via a corrected `merge_subjects()` function that now also moves `classes`, `target_grades`, and `subject_grade_boundaries`, not just `results`; (2) Supabase's default 1000-row cap on unpaginated `.select()` calls was silently truncating `student_class` (4,262 rows), `target_grades`, and `results` fetches — fixed with a paginated `fetchAll()` helper, likely needed on other pages too. Full root-cause chain in `docs/2026-09-04-session-notes.md`.

Added a subject **display name / target fallback overlay** (migration 041, `/admin/subject-settings`) — lets a subject show a friendly label in the UI without touching Nova-T source data (e.g. "Mu" → "Music"), and lets a subject with no target grades of its own borrow another subject's targets for progress comparison (e.g. Business borrows Economics). Applied across Class Progress, the student page (timetable/blocks/targets/results), and both portals.

---

## Current live schema (highlights)

Full column-level detail lives in `docs/schema-snapshot.md`. Structurally:

- **People:** `students` (very wide, SIMS-aligned), `families`, `parents`, `student_parent`
- **Staff:** `staff`, `staff_roles`, `profiles` (auth-linked, one of staff/parent/student per row)
- **Curriculum/timetable:** `subjects` (+ `display_name`, `target_fallback_subject_id` overlay), `curriculum_blocks`, `classes`, `timetable_slots`, `periods`, `student_class`, `terms`
- **Behaviour:** `behaviour_categories`, `behaviour_events`, `behaviour_appeals`
- **Attendance:** `attendance_codes`, `attendance`, `attendance_today` (view)
- **Assessment:** `results`, `grade_scale`, `target_grades`, `subject_grade_boundaries` (per subject + year group), `cat4_results`, `ngrt_results`, `certificates_awarded`
- **Calendar:** `calendar_events`
- **Reporting:** `student_summary` (view)

---

## Established working conventions

- **Phone-first:** SQL delivered in chunks of ~3–4 statements (Supabase mobile SQL editor silently truncates long pastes); large result sets returned as a single TEXT blob rather than a table (100-row display cap on mobile).
- **GitHub PAT workflow:** Chris supplies a fine-grained PAT per session; Claude sets it on the git remote, commits, pushes, strips it from the remote URL immediately after. Chris revokes the PAT after each use.
- **Session notes:** saved to `docs/YYYY-MM-DD-session-notes.md` in the repo.
- **Import path bug pattern:** nested `app/` routes need one extra `../` per directory level (e.g. `app/staff/roles/` needs `../../../lib/`).
- **Auth quirk:** `auth.uid()` returns null when a function is run directly in the Supabase SQL editor, so admin-gated functions built for direct SQL-editor execution can't rely on `is_admin()`.
- **Postgres pattern:** skip-on-duplicate bulk inserts need a nested `BEGIN...EXCEPTION WHEN unique_violation THEN...END` block, not a top-level exception handler.
- **Supabase 1000-row cap:** any unpaginated `.select()` silently truncates at 1000 rows. Tables that can exceed this (`student_class`, `target_grades`, `results`) need a paginated fetch helper — not yet audited across every page that reads them.

---

## Open items (as of the most recent session)

- Execute pending migrations 025–026 once Chris has the updated SIMS export
- Three staff members remain unlinked (missing staff codes)
- Compound block UI doesn't auto-assign sibling classes
- Possible stale seed attendance data from an early seed script — needs review
- Families management UI not yet built
- Term-based filtering not yet wired into results/attendance views
- Decide whether `attendance_today` visibility should be scoped to pastoral/SMT roles rather than all staff
- Consider Vercel Pro plan for institutional compliance
- Confirm whether the most recent PAT has been revoked
- Write a committed migration for the corrected `merge_subjects()` function (currently only applied live via SQL editor)
- Audit other pages for the same 1000-row silent-truncation risk
- Review/correct the seeded WAEC and IGCSE grade boundary guesses per subject
- Decide + document which subjects are intentionally targetless vs just missing data
- Parent transcript PDF with school logo — still not started

---

*This document is a compiled narrative, not a schema reference — see `docs/schema-snapshot.md` for the authoritative table/column list.*
