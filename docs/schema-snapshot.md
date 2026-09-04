# Adorable MIS — Schema Snapshot

**Source:** live dump from Supabase project `drjtcegtucovhbyfdpbx`, pulled via `information_schema.columns`.
**Captured:** 2026-09-03
**How to refresh:** re-run the dump query and paste the new CSV back to Claude with "update the schema snapshot."

> This file is the shared reference. Keep it in the repo at `docs/schema-snapshot.md` and paste it (or link the repo) at the start of a session when you want Claude working from the real current structure instead of memory.

---

## Core people

### students
Primary entity. `student_id` (PK, int). Wide SIMS-aligned profile:
- Identity: `first_name`, `middle_name`, `last_name`, `legal_first_name`, `legal_last_name`, `preferred_name`, `dob`, `gender`, `nationality`, `ethnicity`, `religion`
- School: `year_group`, `form_class`, `admission_date`, `admission_number`, `status`, `leaving_date`
- Contact/address: `student_email`, `address_line1/2`, `city`, `postcode`, `country`, `emergency_contact_name`, `emergency_contact_phone`
- Nigeria-specific: `upn` (Unique Pupil Number, links to legacy/CoreSats `TW Unique ID`), `state_of_origin`, `lga`, `home_town`, `national_identity_number`, `neco_exam_number`, `utme_pin`, `utme_profile_code`, `birth_certificate_seen`, `admitted_letter_date`
- Boarding: `boarding_house`, `boarding_room_number`, `sports_house`, `restaurant`, `swimming_paid`
- Pastoral/SEND flags: `fsm`, `eal`, `send`, `medical_notes`, `custom1`, `custom2`
- `family_id` → `families`
- `photo_base64` (student photo, stored inline on the row rather than in a storage bucket)

### families
`family_id` (PK), `family_name`. Groups sibling students for household-level views.

### parents
`parent_id` (PK), `first_name`, `last_name`, `phone`, `email`, `address`, `relationship_type`.

### student_parent
Join table. `student_id`, `parent_id`, `is_primary_contact` (bool). Composite PK.

---

## Staff & roles

### staff
`staff_id` (PK), `first_name`, `last_name`, `subject_specialism`, `staff_code`, `email`.

### staff_roles
`staff_id`, `role_name`. One row per role a staff member holds (supports multiple roles per person). Backs `is_staff_or_admin()`, `is_pastoral_or_smt()`, `is_assessment_manager()` helper functions used in RLS.

### profiles
Auth-linked identity row. `id` (uuid, = `auth.users.id`), `email`, `role`, and nullable `staff_id` / `parent_id` / `student_id` — one profile type per login (staff, parent, or student portal account).

---

## Curriculum & timetable

### subjects
`subject_id` (PK, integer), `subject_name` (Nova-T source, do not edit directly), `subject_code`, `display_name` (nullable text override shown in UI, falls back to `subject_name`), `target_fallback_subject_id` (nullable FK → subjects.subject_id, used when this subject has no `target_grades` of its own — see `subject_grade_boundaries` below and `/admin/subject-settings`).

### curriculum_blocks
`block_id` (PK), `block_name`, `year_group`, `band`, `is_compound` (bool — Pathway/Vocational blocks that are exempt from the one-class-per-block uniqueness rule).

### classes
Teaching groups. `class_id` (PK), `subject_id` → subjects, `staff_id` → staff, `year_group`, `room`, `class_code`, `block_id` → curriculum_blocks.

### timetable_slots
`slot_id` (PK), `class_id` → classes, `day_of_week`, `period_number`, `start_time`, `end_time`.
Note: slot ordering convention is day-major — `slot = (day-1)*9 + period`.

### periods
Lookup: `period_number` (PK), `period_name`. Covers the 9-slot day (Registration, P1–P6, The Other Half, Evening Prep).

### student_class
Join table. `student_id`, `class_id`, `block_id`, `is_compound` (bool).

### terms
`term_id` (PK), `term_name`, `start_date`, `end_date`.

---

## Behaviour

### behaviour_categories
Lookup. `category_id` (PK), `name`, `type` (positive/negative), `default_points`.

### behaviour_events
`event_id` (PK), `student_id`, `staff_id` (who logged it), `event_date`, `event_time`, `type`, `category`, `points`, `description`.

### behaviour_appeals
`appeal_id` (PK), `event_id` → behaviour_events, `student_id`, `reason`, `status`, `created_at`, `reviewed_by`, `reviewed_at`, `resolution_notes`.
Trigger: upheld appeal zeroes the linked event's points.

---

## Attendance

### attendance_codes
Lookup. `code` (PK), `description`, `status`.

### attendance
Per-period record. `attendance_id` (PK), `student_id`, `attend_date`, `period_number`, `status`, `staff_id`, `notes`, `code` → attendance_codes.
Unique per (student, date, period) by design.

### attendance_today
View. `student_id`, `attend_date`, `period_number`, `code`, `description`, `status`, `is_present` — read-only cross-period visibility (e.g. P3 teacher can see P1/P2 status for a student).

---

## Assessment & results

### results
Weekly subject results. `result_id` (PK), `student_id`, `subject_id`, `week_start_date`, `score`, `max_score`, `grade`, `staff_id` (entered by), `comments`.

### grade_scale
Lookup. `grade` (PK), `points` (numeric) — for grade-to-points conversion (e.g. RAG comparisons).

### target_grades
`student_id`, `subject_id`, `target_grade`. Composite key — used for red/amber/green comparison against `results`.

### subject_grade_boundaries
Grade cutoffs used to compute `results.grade` from `results.score` at import time. Defined **per subject and per year group** — not a single shared scale, since Year 12 uses WAEC-style A1–F9 and other years use IGCSE A*–G, and different subjects have different actual percentage cutoffs even within the same scale type. `id` (PK), `subject_id` → subjects, `year_group` (integer), `grade`, `min_score`, `max_score`. Unique on `(subject_id, year_group, grade)`. Editable per subject/year on `/admin/grade-boundaries`. Current values are seeded starting guesses (WAEC for Year 12, a generic 90/80/70/60/50/40/30 IGCSE split for Years 7–11) — not confirmed school policy, review before relying on for reporting.

### cat4_results
Predictive/cognitive ability scores. `cat4_id` (PK), `student_id`, `test_date`, `level`, `mean_sas`, `verbal_sas`, `non_verbal_sas`, `quantitative_sas`, `spatial_sas`.

### ngrt_results
Reading test scores. `ngrt_id` (PK), `student_id`, `test_date`, `form`, `sas`, `pc_stanine`, `sc_stanine`, `overall_stanine`, `reading_age` (text, YY:MM format).

### certificates_awarded
`student_id`, `milestone`, `awarded_date`. No surrogate PK listed — likely composite (student_id, milestone).

---

## Calendar

### calendar_events
`event_id` (PK), `event_date`, `event_name`, `category` (includes `"relp"` for formal assessments), `year_group_note`.

---

## Reporting view

### student_summary
Rollup view for list/dashboard screens. `student_id`, `first_name`, `last_name`, `year_group`, `form_class`, `status`, `positive_points`, `negative_points`, `net_behaviour_points`, `last_behaviour_event_date`, `latest_week_avg_pct`, `latest_results_week`, `primary_contact_name`, `primary_contact_phone`.

---

## Known gaps in this snapshot

The dump only pulled `information_schema.columns`, so **primary keys, foreign keys, indexes, defaults, and RLS policies aren't captured here** — the relationships above are inferred from column naming and prior session notes, not verified against constraints. If you want the full picture, run this second query and send the result back:

```sql
select
  tc.table_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name as references_table,
  ccu.column_name as references_column
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
left join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name and tc.constraint_type = 'FOREIGN KEY'
where tc.table_schema = 'public'
  and tc.constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')
order by tc.table_name, tc.constraint_type desc;
```

Also not yet reflected here (per your open items list): the CSV results importer accepting ReLP names, families management UI, and full term-based filtering on results/attendance — those are app-layer, not schema, so they won't show up in this dump anyway.
