# Homework: design

Status, 30 September 2026: **design only, nothing built.** Open questions for
the principal are at the end. Where a question has a recommended answer, the
design below assumes it.

What was asked for:

1. A teacher types in a piece of homework, chooses a deadline, and picks a
   grading system for it.
2. The homework shows up on the student's weekly timetable, as a link that
   expands.
3. The teacher records a grade against each student in the class.
4. Those grades sit **outside the reporting process**: they never feed
   reports, transcripts, result sets or target grades.

## What exists today (checked against the live database, 30 Sept 2026)

- **Nothing for homework.** No table, page or function. The only "homework"
  in the schema is `report_subject_comments.homework_grade`, the grade a
  teacher types when writing a report (migration 192). That stays the
  teacher's own judgement and is not touched by this design.
- **Classes:** 338 classes, 49 class teachers, every class has a subject, 5
  have no teacher. `classes.staff_id` is the class teacher. **11 single
  lessons** are taught by someone else (`timetable_slots.staff_id`,
  migration 182), e.g. one lesson of LEE's 8A1/Hu is VAE's.
- **Students:** 278 active, 272 with a login (`profiles.student_id`). Class
  membership is `student_class`, which the Nova-T UPN/Class import keeps
  current, removing enrolments the export no longer lists.
- **The student timetable** is on `/portal` (`app/portal/page.js`, the
  `#timetable` view). It is a static Mon–Fri × period grid with no dates.
  Each cell is built from `student_class → classes → timetable_slots` into a
  `cellMap` keyed `Mon-3`, and shows subject, room · teacher and time. The
  parent portal (`app/parent-portal/page.js`) builds the same grid for each
  child.
- **Grading:** there is no reusable, named grading scale. `grade_scale` is a
  single global A*–U list (for target and transcript grades), and
  `subject_grade_boundaries` maps scores to grades per subject and year for
  reporting. Neither is right for homework: a teacher wants to pick "out of
  20" or "Complete / Incomplete" for one task without changing anything a
  report reads.
- **Access helpers that already exist:** `is_admin()`, `is_staff_or_admin()`,
  `has_resource_access()`, `user_has_staff_role()`,
  `teaches_student_for_subject()` and `my_current_child_ids()`. Heads of
  Department are scoped by `staff_roles.scope_value = subjects.department_name`
  (5 departments, 4 HoDs). **There is no `my_student_id()`**: student policies
  repeat `exists (select 1 from profiles p where p.id = auth.uid() and
  p.student_id = …)`. **`teaches_student_for_subject()` ignores single-lesson
  overrides**, so it isn't enough on its own for "may set homework for this
  class".

## Decision 1: homework belongs to a class, not to a student list

A piece of homework is set for **one class** (`classes.class_id`). Everyone in
`student_class` for that class sees it, including students who join the class
later. The mark book lists the class's current students plus anyone who
already has a mark (so a student who moves set keeps their grade).

Classes are deleted and recreated at the year switch (admissions design,
Decision 6), so the homework row also keeps the `subject_id`, `class_code`,
`year_group` and `academic_year_id` it was set for, and `class_id` is
`on delete set null`. The record survives the class.

Where one lesson belongs to someone else (the 11 overrides), both teachers can
set and mark homework for the class. That matches how registers work.

## Decision 2: grading systems are a short list the school controls

A teacher picks one **grading scheme** per homework. The schemes are data,
edited at `/admin/lookups` (like the behaviour rules and certificate levels,
migration 262), so nobody hard-codes them.

Seeded schemes (proposed):

| Scheme | Kind | Values |
|---|---|---|
| Mark out of … | `mark` | a number from 0 to the "out of" the teacher sets on the homework |
| Percentage | `mark` | 0–100 |
| A*–U | `list` | A*, A, B, C, D, E, F, G, U |
| 9–1 (IGCSE) | `list` | 9, 8, 7, 6, 5, 4, 3, 2, 1, U |
| WAEC | `list` | A1, B2, B3, C4, C5, C6, D7, E8, F9 |
| Effort 1–4 | `list` | 1, 2, 3, 4 |
| Complete / Incomplete | `list` | Complete, Incomplete |
| Not graded | `none` | nothing to record |

Every scheme also accepts two outcomes that aren't grades: **Not handed in**
and **Excused**. So a teacher can record a missing piece even on an ungraded
task.

A scheme in use can be retired (`is_active = false`, no longer offered) but
not deleted or have its values removed, so old grades stay readable.

## Decision 3: homework grades are kept apart from reporting

- Homework marks live in their own table, `homework_marks`. They are **never**
  written to `results`, never tagged to a result set (`calendar_events`), and
  never read by `lib/reportWriting.js`, `lib/generateWrittenReport.js`,
  `lib/generateKeyStageTranscript.js`, `lib/transcriptGrades.js`, target
  grades or `missing_grades_by_class()`.
- Report writing keeps its own `homework_grade`. Showing a teacher a summary
  of a student's homework record *while* they write that grade is a later
  option (open question 5), not part of this build.
- **Changes are still logged permanently.** CLAUDE.md requires every grade
  table to carry `trg_log_grade_change`. `log_grade_change()` is nearly
  generic already. It needs one new `case` branch so that a
  `homework_marks` row is keyed by `(homework_id, student_id)`, and the mark
  column is named `score` so it is picked up as old/new score. At
  `/assessments/grade-history` a "Homework" filter keeps these rows apart
  from reporting grades, and they are hidden by default.

## Tables (one migration, 276)

All three tables get RLS, per-table grants to `authenticated` only (for the
verbs their policies allow), the `a_backup_mode_guard` trigger, and
`stamp_actor()` on their "who did it" columns.

### `homework_schemes`

| Column | Notes |
|---|---|
| `scheme_id` serial PK | |
| `name` text unique | "Mark out of …" |
| `kind` text | `mark` / `list` / `none` |
| `fixed_max` numeric null | 100 for Percentage; null means the teacher sets "out of" |
| `is_active` boolean | retired schemes aren't offered for new homework |
| `sort_order` int | |

### `homework_scheme_values`

`(scheme_id, value)` PK, `sort_order`. Only for `kind = 'list'`.

### `homework`

| Column | Notes |
|---|---|
| `homework_id` bigserial PK | |
| `class_id` → `classes` | `on delete set null` |
| `subject_id`, `class_code`, `year_group`, `academic_year_id` | **copied from the class by trigger** on insert. The request can't choose them. |
| `title` text | required, up to 200 characters |
| `instructions` text | up to 5,000 characters. Stored and shown as **plain text**, with web links made clickable and nothing else rendered. |
| `set_on` date | defaults to today |
| `due_on` date | the deadline, which must be on or after `set_on` |
| `due_slot_id` → `timetable_slots` null | which lesson it's due in. The form suggests the class's next lessons. Null means "by the end of that day". `on delete set null`. |
| `scheme_id` → `homework_schemes` | must be active when the homework is set |
| `out_of` numeric null | required when the scheme is "Mark out of …", otherwise null |
| `marks_released` boolean | false until the teacher releases the marks to students and parents |
| `status` text | `set` or `withdrawn`. Withdrawn homework disappears for students but stays for staff. |
| `set_by_staff_id`, `created_by`, `updated_by`, `created_at`, `updated_at` | stamped from `auth.uid()` |

A homework with any marks can't be deleted, only withdrawn (trigger). With no
marks it can be deleted outright, for example to fix a mistake.

### `homework_marks`

| Column | Notes |
|---|---|
| `homework_id`, `student_id` | PK |
| `subject_id` | copied from the homework by trigger, for the grade log |
| `grade` text null | for `list` schemes: must be one of the scheme's values, or `Not handed in` / `Excused` |
| `score` numeric null | for `mark` schemes: 0 to `out_of` (or `fixed_max`) |
| `comment` text null | short feedback, up to 1,000 characters |
| `recorded_by`, `updated_at` | stamped |

The trigger `homework_marks_check()` enforces the scheme rules above. It also
checks, on insert, that the student is in the class now (`student_class`), so
a teacher can't attach a grade to a student they don't teach. A mark already
recorded can still be changed after the student leaves the class.

## Helper functions

- **`my_student_id()`**: `security definer stable`. Returns the signed-in
  user's `profiles.student_id`, or null. New, but it replaces the inline
  pattern only in the new policies (existing policies are left alone).
- **`can_set_homework(p_class_id int)`**: `security definer stable`. True if
  the caller:
  - is the class teacher (`classes.staff_id` = their `profiles.staff_id`), or
  - teaches any single lesson of that class (`timetable_slots.staff_id`), or
  - is Head of Department for the class's subject (`staff_roles` scope =
    `subjects.department_name`), or
  - is admin.

  Identity comes only from `auth.uid()`. A class ID in the request is
  checked, not trusted.
- **`homework_for_week(p_student_id int, p_week_start date)`**: `security
  definer`. Returns the week's homework for one student, with their own mark
  only if it has been released. It checks the caller first: the student
  themselves (`my_student_id()`), their parent (`p_student_id in
  my_current_child_ids()`), or staff. It saves the portal from joining four
  tables under three different policies, and it is the one place the "only
  released marks" rule is applied for students and parents.

## Access control

The database is the boundary. The page guards only decide what to show.

| Who | Homework (the task) | Marks |
|---|---|---|
| **Class teacher / teacher of any lesson of the class** | create, edit, withdraw, delete (if unmarked) for that class | record, change and remove marks for students in that class; release them |
| **Head of Department** | the same, for classes in their department | the same, for their department |
| **Admin** | the same for all classes | the same for all classes |
| **SMT, pastoral, mentors, other staff** | read all | read all (staff can already read all `results`; recommended the same here, see open question 2) |
| **Student** | read homework for classes they're in (status `set`) | read **their own** marks, only once released |
| **Parent** | read homework for their current children's classes (via `my_current_child_ids()`, so leavers drop out, per migration 255) | read their children's own marks, only once released |
| **Anyone else / not signed in** | nothing | nothing |

The RLS policies, in outline:

- `homework`:
  - select: `is_staff_or_admin()`; or the class is one of
    `my_student_id()`'s classes and `status = 'set'`; or the class is one of a
    current child's classes and `status = 'set'`.
  - insert: `can_set_homework(class_id)`, with the check pinning
    `status = 'set'` and `marks_released = false`.
  - update: `can_set_homework(class_id)` in both `using` and `with check`, so
    homework can't be moved to someone else's class.
  - delete: `can_set_homework(class_id)`, plus the "no marks" trigger.
- `homework_marks`:
  - select: `is_staff_or_admin()`; or `student_id = my_student_id()` and the
    homework is released; or `student_id in (select my_current_child_ids())`
    and the homework is released.
  - insert, update and delete: `can_set_homework()` on the homework's class.
- `homework_schemes` and `homework_scheme_values`:
  - select: any signed-in user.
  - write: `has_resource_access('/admin/lookups')`.

Grants: `select, insert, update, delete` on `homework` and `homework_marks`;
`select, insert, update` on the two scheme tables (no delete, by Decision 2).

Nothing goes through `app/api`, so no server route is added and
`scripts/check-api-auth.js` is unaffected. Students and parents write
nothing.

### Things this deliberately closes off

- **A student seeing a classmate's grade.** Marks are readable by a student
  only where `student_id = my_student_id()`. The mark book is a staff page.
- **Grades showing before the teacher is ready.** `marks_released` is checked
  in the policy and in `homework_for_week()`, not in the page.
- **Setting homework for a class you don't teach**, by editing the
  `class_id` in a copied request. `can_set_homework()` is re-checked on
  update.
- **Faking the subject or year** to make homework appear elsewhere: these are
  copied from the class by trigger.
- **Scripts in instructions.** Instructions are plain text, rendered as text.
  Only `https://` links are turned into links, opened with
  `rel="noopener noreferrer"`.

## Pages

### Staff: `/homework` (new resource, Assessment section)

Resource `/homework`, granted to `teacher`, `head_of_department`, `smt` and
`admin`. The tile shows, but which classes a person can act on is decided by
`can_set_homework()`.

- **My classes**: the classes from `loadStaffLessons()` (so single-lesson
  overrides are included), plus the department's classes for a HoD. Under
  each, its homework: upcoming, past, and how many are marked.
- **Set homework**: class, title, instructions, deadline (a date picker
  offering the class's next few lessons as one-click choices, which fills
  `due_slot_id`), grading scheme, and "out of" when the scheme needs it.
  There is also a "Set for several classes" option, for a teacher with parallel sets.
  It creates one row per class.
- **Mark book** for one homework: the class list with one input per student
  suited to the scheme (a number box, a drop-down, or a Complete tick),
  buttons for Not handed in and Excused, an optional comment, a "Mark all
  handed in / Complete" shortcut, and **Release marks**.
- Later: a department / whole-school overview (open question 4).

On the staff timetable (`/staff/timetable`), a small marker on a lesson shows
homework is due that lesson. Clicking it opens the mark book.

### Students: the timetable on `/portal`

- The grid gets a **week selector**: this week by default, with previous and
  next buttons. Today the grid has no dates, so this is the main change.
- Homework is placed in the cell of **the lesson it is due in**
  (`due_slot_id`). Without one, it goes in the class's first lesson that day.
  If the class has no lesson that day, it goes in a "Due" strip under that
  day's column heading.
- The cell shows a **"Homework" chip**. Tapping it expands a panel in place
  (on a phone, a panel below the grid) with the title, instructions, subject,
  teacher, set date, deadline, how it's graded, and the student's grade and
  comment once released. Overdue homework without a mark is shown in amber;
  there is no penalty logic.
- A **Homework** tile on the student home lists what's due in the next 7 days
  and recently graded work, for students who don't think in timetable cells.
- The print view of the timetable leaves homework out.

### Parents: the same grid on `/parent-portal`

The same data comes from `homework_for_week()`, one child at a time. This is
recommended (open question 1) but can be switched off at launch without any
schema change: the parent policy clauses are simply left out.

### Admin: `/admin/lookups`

A "Homework grading" card, where Lookups holders add schemes, add values and
retire schemes.

### Shared code

- `lib/homework.js`: `loadHomeworkForWeek()`, `placeHomeworkInCells(cellMap,
  homework, lessons)` and `weekStart(date)`.
- `app/components/HomeworkChip.js`: the chip and its expanding panel, used by
  the portal, the parent portal and the staff timetable.

The existing `cellMap` shape (`Mon-3 → [entries]`) gains an optional
`homework` array per entry, so the grid rendering barely changes.

## Notifications

None at launch. The timetable and the Homework tile are the notice. Options
for later (open question 3):

- An inbox notice to the class when homework is set.
  `post_student_notice()` hardcodes the kind `'detention'`, so it would need
  a kind parameter first.
- A "due tomorrow" digest.
- A notice when marks are released.

Any email would go through `queue_workspace_email()` with a new
`email_reply_to('homework')` row. Its reply-to should be the setting teacher,
which the reply routes don't support yet.

## Year switch, leavers and imports

- **Nova-T class import:** classes are matched and updated in place, so
  homework stays attached. If a class is deleted, `class_id` becomes null and
  the homework keeps its subject and class code for the record.
- **Students changing set:** their marks stay under the old homework. They
  see the new class's homework from the moment `student_class` changes.
- **Leavers:** the login is locked (migration 251) and parents stop seeing
  them (migration 255). Marks are kept, readable by staff.
- **Next year:** homework carries `academic_year_id`. Once the switch has
  run, the portal shows only the current year's (the student is no longer in
  last year's classes). Last year's released marks stay visible to the student
  through `homework_marks` (open question 6 asks whether that's wanted).
- **Backup mode:** new tables carry `a_backup_mode_guard`, so teachers can't
  save during a backup, as elsewhere.

## Order to build it in

1. **Migration 276:** the tables, helpers, triggers, policies, grants, the
   seed schemes, the `/homework` resource and its role permissions, and the
   `log_grade_change()` branch.
2. **`/homework`:** set, list and edit homework, then the mark book and
   Release.
3. **Student timetable:** the week selector, chips and panel, then the
   Homework tile.
4. **Parent portal**, if agreed.
5. **Staff timetable** marker, the Lookups card, and the Grade History filter.
6. Update `docs/SYSTEM_RULES.md`, the Functional Specification and the PRD,
   and regenerate `sql/CURRENT_SCHEMA.md`.

**Test before release**, signed in as each role:

- A teacher sets homework and marks it for their own class, but is refused
  for another class, including by an edited request.
- A single-lesson override teacher can set homework for that class.
- A HoD can act in their department only.
- A student sees their own classes' homework, and their own grade only after
  release, never a classmate's.
- A parent sees only a current child's homework.
- Withdrawn homework disappears for students.
- A grade outside the scheme is refused.
- Every mark change appears in the grade history.

## Open questions for the principal

1. **Parents:** should parents see homework and released grades on the
   parent portal? *Recommended: yes, read-only.*
2. **Staff visibility:** may all staff (mentors, pastoral, SMT) read every
   homework grade, as they can read results today, or only the class's
   teachers, HoD, SMT and admin? *Recommended: all staff, for consistency and
   so mentors can follow up missing work.*
3. **Notifications:** should students (or parents) get an inbox notice or
   email when homework is set or marks are released? *Recommended: not at
   launch.*
4. **Oversight:** should HoDs and SMT get an overview (homework set per class
   per week, and how many not handed in), and should HoDs be able to set and
   edit homework in their department or only view it? *Recommended: an
   overview in phase 2; HoDs can edit.*
5. **Reports:** stay completely separate, or show the teacher a student's
   homework record as a hint while they write the report's homework grade?
   *Recommended: separate at launch, the hint later.*
6. **Past years:** should students keep seeing last year's homework grades
   after the year switch? *Recommended: yes, in the Homework tile only.*
7. **Online hand-in:** should students be able to upload their work (a new
   private storage bucket, like `student-documents`)? *Recommended: not in
   this build. It is the biggest addition in size and in safeguarding
   terms (files from students), and can come later without changing
   anything above.*
