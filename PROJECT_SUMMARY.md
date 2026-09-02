# Adorable MIS — Project Summary

School management information system for a ~250-student secondary school.

- **GitHub repo:** classroomportal/adorable_mis
- **Live app:** https://adorable-mis.vercel.app (custom domain `mis.classroomportal.org` not yet connected)
- **Database:** Supabase project `adorable_mis` (separate from the `Adorable Maths Walkthrough` revision portal project)
- **Hosting:** Vercel, auto-deploys from the `main` branch

---

## Database schema

Core tables:
- `students` — extensive core data (see "Student fields" below)
- `parents` + `student_parent` (many-to-many, supports multiple guardians/siblings)
- `families` — links siblings together via `students.family_id`
- `subjects`, `staff`, `classes`, `timetable_slots`, `student_class` — timetable structure
- `periods` — the fixed 9-slot daily structure (Registration, Period 1–6, The Other Half, Evening Prep)
- `behaviour_events` — positive/negative incidents with points
- `attendance` — per-date (optionally per-period) status: present/late/authorized_absence/absent
- `results` — weekly per-subject scores/grades
- `terms` — academic term date ranges (created, not yet wired into UI filtering)
- `profiles` — links Supabase Auth users to a role (`admin` or `staff`)

### Student fields
Beyond the basics (name, DOB, year group, form class), the following were added to match your real SIMS data:
- Legal first/last name, preferred/chosen name, middle name
- UPN (unique pupil number)
- Student email
- Full address (line 1/2, city, postcode, country)
- Nationality, religion, state of origin, LGA, home town
- Boarding house, boarding room number, sports house
- National identity number, NECO exam number, UTME PIN, UTME profile code
- Emergency contact name/phone
- Medical notes
- `admission_date`, `admitted_letter_date`, `leaving_date`, `status` (active/left)
- `family_id` — links to siblings

### Automatic status handling
A database trigger (`auto_set_student_status`) automatically sets `status = 'left'` whenever a row is inserted/updated with a `leaving_date` on or before today. This fires on writes only — it does not run on a daily schedule (would need `pg_cron`, a paid Supabase feature).

### Row Level Security
- All tables are read-accessible to any authenticated (logged-in) user.
- **Admin role**: full write access to all structural/core data (students, parents, staff, classes, timetable, subjects, terms, families).
- **Staff role**: can insert/update `results` and `behaviour_events` and `attendance` (day-to-day data entry), but cannot edit core student records.
- Role is determined by the `profiles` table (`role` column), linked to each person's Supabase Auth account by `id`.
- An `is_admin()` SQL helper function avoids RLS recursion issues on the `profiles` table itself.

---

## Front-end app (Next.js + Supabase)

Pages:
- `/` — home
- `/login` — email/password sign-in
- `/students` — list with search (name) and filters (year group, form class); links to detail pages
- `/students/[id]` — full student profile: core data (with Simple/Full view toggle), editable by admin, siblings list, timetable grid, attendance summary, behaviour log, results history
- `/results` — weekly results entry form + recent results table
- `/results/import` — CSV bulk importer (matches students by UPN, subjects by subject_code)
- `/behaviour` — behaviour event entry form + recent events table
- `/attendance` — daily register (radio-button grid per student) + recent entries

Design: red/pale-yellow theme, mobile-responsive (horizontally scrollable tables, stacking forms on small screens).

Auth: Supabase Auth (email/password). Admin accounts and staff accounts are created manually via the Supabase dashboard (Authentication → Users), then linked to a role via an `INSERT INTO profiles` SQL statement.

---

## Known gaps / next steps

1. **Timetable is incomplete** — only 3 of 9 daily periods have real class data (Maths/English/Science placeholders). Needs your full subject list, staff list, and class assignments to complete the 9-period, 5-day grid for every student.
2. **Custom domain** (`mis.classroomportal.org`) not yet connected in Vercel — DNS/CNAME step was paused.
3. **Old MIS tables still exist in the revision portal's Supabase project** (`Adorable Maths Walkthrough`) — duplicated here but not yet cleaned up from the original project.
4. **No UI for managing `families`** — sibling links currently require setting `family_id` manually via SQL or the student edit form (no dedicated "create family" screen).
5. **Attendance is whole-day only** — not yet broken down per period, despite the 9-period day structure existing.
6. **No term-based filtering** in the UI yet, though the `terms` table exists.
7. **CSV import only covers results** — no equivalent bulk import yet for students, parents, or attendance.
8. **First admin/staff accounts must be created manually** in Supabase Authentication — no self-serve invite flow yet.

---

## Migration files (run in order against Supabase SQL editor)

Located in `/sql` in the repo:
1. `schema.sql` — original core schema
2. `002_auth_roles_periods.sql` — profiles/roles, periods table, RLS policies
3. `003_full_timetable_seed.sql` — placeholder timetable data
4. `004_more_results.sql` — sample results
5. `005_terms_attendance.sql` — terms + attendance tables
6. `006_extended_student_fields.sql` — families table, extended personal/address fields
7. `007_upn_sims_fields.sql` — UPN and SIMS-matching fields
8. `008_boarding_house.sql`
9. `009_leaving_date.sql`
10. `010_auto_status_trigger.sql` — automatic status-on-leaving-date logic

(Note: some fixes, like the `is_admin()` recursion fix, were applied as ad-hoc SQL in chat rather than saved as numbered migration files — worth consolidating into the repo for a clean rebuild if ever needed.)
