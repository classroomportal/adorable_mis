# Homework: design

Status, 30 September 2026: **pilot built and live** (migrations 278–279) on
the principal's two maths classes, 10_1/Ma and 11_1/Ma (`homework_classes`).
Built:
- the tables, rules and grade log;
- `/homework` (set, edit, withdraw, mark book, release marks);
- homework chips and a week selector on the student timetable;
- the Homework tile's by-day grid;
- the Grade History filter.

Not built yet:
- `/homework/overview`;
- the report-writing hint;
- the staff timetable marker;
- the Lookups card for grading schemes (edit them in SQL for now);
- "Set for several classes".

Since then (the principal, 30 Sept 2026):
- teachers set homework from the class register (a Homework panel on `/attendance`);
- students have big tiles on their home page, with Homework second;
- the order of the big tiles is set school-wide at `/admin/tile-order` (migration 280);
- teachers can attach files and `https://` links to homework (migration 281, private `homework-files` bucket, 20 MB per file). Student hand-in is still "not yet".
- a mark is converted to a grade from the subject's boundaries (migration 289), and each class has a mark sheet over a date range with each student's average.
- students tick homework done (migration 288, `homework_done`). A done card turns green and shrinks to the subject. Overdue is red, due today amber and graded purple. Teachers see the ticks in the mark book.

Widening the pilot means adding classes to `homework_classes` and granting
`/homework` to `teacher` and `head_of_department`.

Revised the same day with the principal's answers (listed under "Decided" at the end): parents
don't see homework, grades are visible only to the class's teachers, the Head
of Department, SMT and admin, there are no notifications, HoDs and SMT get an
overview, report writers get a homework hint, students don't keep past years'
grades, and there is no online hand-in yet.

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

> **Changed by migration 291 (the principal, 30 Sept 2026).** Homework marks
> now follow the student and feed the end-of-term written report, through
> `homework_report_summary()` only. The report writer shows the term's
> average, grade and counts and pre-fills the Homework judgement from it; the
> printed report shows the grade only (never the percentage); a subject with
> no marks keeps the teacher's judgement. Transcripts, result sets, target
> grades and `results` still never read homework. See "Changes after the
> pilot started" at the end. The text below is the original decision.

- Homework marks live in their own table, `homework_marks`. They are **never**
  written to `results`, never tagged to a result set (`calendar_events`), and
  never read by `lib/reportWriting.js`, `lib/generateWrittenReport.js`,
  `lib/generateKeyStageTranscript.js`, `lib/transcriptGrades.js`, target
  grades or `missing_grades_by_class()`.
- Report writing keeps its own `homework_grade`, typed by the teacher. The
  report-writing page shows the teacher a **hint**: the student's homework
  record in that subject for the report period (see "Report-writing hint"
  under Pages). It is shown next to the box, never copied into it, and
  nothing is saved from it.
- **Changes are still logged permanently.** CLAUDE.md requires every grade
  table to carry `trg_log_grade_change`. `log_grade_change()` is nearly
  generic already. It needs one new `case` branch so that a
  `homework_marks` row is keyed by `(homework_id, student_id)`, and the mark
  column is named `score` so it is picked up as old/new score. At
  `/assessments/grade-history` a "Homework" filter keeps these rows apart
  from reporting grades, and they are hidden by default.
- **The grade log must not widen who sees homework grades.** `grade_history`
  is readable by SMT and assessment managers (`grade_history_read`).
  Assessment managers aren't among those who may see homework grades (see
  Access control), so that policy gains `and (table_name <> 'homework_marks'
  or user_has_staff_role(array['smt']))`. Admins pass through
  `user_has_staff_role()` as usual.

## Tables (one migration, 278)

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
| `title` text | required, up to 200 characters; at most 10 from migration 290 (enforced on insert and on a title change, so it fits the mark sheet) |
| `instructions` text | up to 5,000 characters. Stored and shown as **plain text**, with web links made clickable and nothing else rendered. |
| `set_on` date | defaults to today |
| `due_on` date | the deadline, which must be on or after `set_on` |
| `due_slot_id` → `timetable_slots` null | which lesson it's due in. The form suggests the class's next lessons. Null means "by the end of that day". `on delete set null`. |
| `scheme_id` → `homework_schemes` | must be active when the homework is set |
| `out_of` numeric null | required when the scheme is "Mark out of …", otherwise null |
| `marks_released` boolean | false until the teacher releases the marks to the students |
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
- **`can_view_homework_marks(p_class_id int)`**: `security definer stable`.
  True if `can_set_homework(p_class_id)` is true or the caller holds `smt`
  (via `user_has_staff_role()`, so admin too). This is who may read grades
  (the principal's decision, 30 Sept 2026). Mentors, pastoral staff,
  assessment managers and other staff can't.
- **`my_homework(p_from date, p_to date)`**: `security definer`. Returns the
  signed-in student's homework due between the two dates, with their own mark
  only if it has been released and belongs to the **current academic year**.
  It takes no student ID: it uses `my_student_id()`, and returns nothing for
  anyone who isn't a student. It saves the portal from joining four tables,
  and it is the one place the student-facing rules are applied (released
  marks only, current year only, withdrawn homework hidden). The timetable
  asks for one week. The Homework grid asks for one week, plus the previous
  four weeks for its Overdue and Recently graded lists.

## Access control

The database is the boundary. The page guards only decide what to show.

| Who | Homework (the task) | Marks |
|---|---|---|
| **Class teacher / teacher of any lesson of the class** | create, edit, withdraw, delete (if unmarked) for that class | record, change and remove marks for students in that class; release them |
| **Head of Department** | the same, for classes in their department | the same, for their department |
| **Admin** | the same for all classes | the same for all classes |
| **SMT** | read all | read all |
| **Pastoral, mentors, assessment managers, other staff** | read all (what was set and when) | **nothing** |
| **Student** | read homework for classes they're in (status `set`) | read **their own** marks, only once released, and only for the current academic year |
| **Parent** | nothing (the principal's decision) | nothing |
| **Anyone else / not signed in** | nothing | nothing |

Staff can read every homework *task* so that a mentor or a cover teacher can
see what a student has been set. Only the grades are restricted.

The RLS policies, in outline:

- `homework`:
  - select: `is_staff_or_admin()`; or the class is one of
    `my_student_id()`'s classes and `status = 'set'`. There is no parent
    clause.
  - insert: `can_set_homework(class_id)`, with the check pinning
    `status = 'set'` and `marks_released = false`.
  - update: `can_set_homework(class_id)` in both `using` and `with check`, so
    homework can't be moved to someone else's class.
  - delete: `can_set_homework(class_id)`, plus the "no marks" trigger.
- `homework_marks`:
  - select: `can_view_homework_marks()` on the homework's class; or
    `student_id = my_student_id()`, the homework is released and not
    withdrawn, and its `academic_year_id` is the year whose `status =
    'current'` in `academic_years`. There is no parent clause.
  - insert, update and delete: `can_set_homework()` on the homework's class.
- `homework_schemes` and `homework_scheme_values`:
  - select: any signed-in user.
  - write: `has_resource_access('/admin/lookups')`.

Grants: `select, insert, update, delete` on `homework` and `homework_marks`;
`select, insert, update` on the two scheme tables (no delete, by Decision 2).

Nothing goes through `app/api`, so no server route is added and
`scripts/check-api-auth.js` is unaffected. Students write nothing. Parents
neither read nor write anything.

### Things this deliberately closes off

- **A student seeing a classmate's grade.** Marks are readable by a student
  only where `student_id = my_student_id()`. The mark book is a staff page.
- **Grades showing before the teacher is ready.** `marks_released` is checked
  in the policy and in `my_homework()`, not in the page.
- **Staff outside the class reading grades**, whether directly, through the
  grade history, or through the overview. Every read path goes through
  `can_view_homework_marks()` or the narrowed `grade_history_read`.
- **Parents.** No policy mentions parents. A parent login gets empty results
  even from a hand-made request.
- **Last year's grades after the year switch.** The student policy and
  `my_homework()` check the current academic year. Staff still see them.
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
- A Head of Department sees their department's classes here and can set,
  edit and mark homework in them, like the class teacher.

On the staff timetable (`/staff/timetable`), a small marker on a lesson shows
homework is due that lesson. Clicking it opens the mark book.

### HoD and SMT: `/homework/overview` (new resource, Assessment section)

Resource `/homework/overview`, granted to `head_of_department`, `smt` and
`admin`. It is read-only, and one week is shown at a time (with the same week
selector).

- **One row per class**, grouped by department then year group, with:
  - the teacher
  - how many pieces of homework were set that week
  - how many have marks recorded
  - how many "Not handed in"
  - whether marks have been released
- **Classes with nothing set that week** are listed too, so gaps show.
- **Clicking a class** opens its homework and mark books, read-only unless the
  viewer can also set homework for it (as a HoD in their own department can).
- **A HoD sees only their department.** This isn't a filter in the page:
  `can_view_homework_marks()` only returns rows for their department's
  classes. SMT and admin see every department.
- **A "Not handed in" list** under the table: the students with two or more
  missing pieces that week, with the subjects.

### Report-writing hint (`/reports/write-subject-comments`)

Next to the report's homework-grade box, the page shows the student's
homework in that subject during the report period, read-only. For example:
"8 set · 7 marked · 1 not handed in", and the grades, newest first.

- **It is only a prompt.** The teacher still chooses and types the report's
  grade. Nothing is copied or saved from the hint.
- **It reads `homework_marks` under the normal policy.** The report writer
  teaches the class, so `can_view_homework_marks()` lets them see it. A
  writer who doesn't teach the class sees no hint.
- **The period** is the report period's term (`report_periods.term_id` →
  `terms.start_date` to `end_date`).

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
- The print view of the timetable leaves homework out.

### Students: the Homework tile, a by-day grid of deadlines

The timetable answers "what's due in this lesson?". The Homework tile answers
"what's due, and when?". It is a new tile on the student home, next to
Timetable. It opens the `#homework` view on `/portal`, and it shows a badge
with the number of pieces still due this week.

- **One column per school day**, Mon–Fri, headed with the date ("Tue 6 Oct").
  **Today's column is highlighted.** If any homework is due on a Saturday or
  Sunday, a Weekend column is added; otherwise it isn't shown.
- **The same week selector** as the timetable (this week, previous, next). The
  two views share the chosen week, so switching between them keeps the student
  in the same week.
- **Each column lists the homework due that day as cards**, in lesson order.
  A card shows:
  - the subject
  - the title
  - the lesson it is due in ("L3"), or "end of day"
  - a status: **Due**, **Overdue** (past the deadline with no mark, in
    amber), **Not handed in**, **Excused** or **Graded** (with the grade,
    once released)
- **Tapping a card opens the same panel as the timetable chip**
  (`HomeworkChip`), with the instructions, the teacher and the grade.
- **Under the grid**, two short lists:
  - **Overdue**, from earlier weeks: past the deadline, no mark yet, from the
    last four weeks.
  - **Recently graded**: released grades for homework due in the last four
    weeks.
- **Empty days say "Nothing due"**, so a blank column isn't mistaken for a
  loading error.
- **On a phone**, the columns stack as one section per day, with today first
  and the rest of the week after it.

This view needs no extra data. It uses the same `my_homework()` call as the
timetable, grouped by `due_on` instead of by lesson. The Overdue and Recently
graded lists come from the same call over the previous four weeks. The
grouping lives in `lib/homework.js` (`groupHomeworkByDay()`), next to
`placeHomeworkInCells()`.

### Parents: nothing

Parents don't see homework or homework grades (the principal's decision). The
parent portal is unchanged.

### Admin: `/admin/lookups`

A "Homework grading" card, where Lookups holders add schemes, add values and
retire schemes.

### Shared code

- `lib/homework.js`: `loadMyHomework()`, `placeHomeworkInCells(cellMap,
  homework, lessons)`, `groupHomeworkByDay(homework, weekStart)` and
  `weekStart(date)`.
- `app/components/HomeworkChip.js`: the chip and its expanding panel, used by
  the student portal and the staff timetable.

The existing `cellMap` shape (`Mon-3 → [entries]`) gains an optional
`homework` array per entry, so the grid rendering barely changes.

## Notifications

None (the principal's decision). There are no inbox notices and no emails,
to students or anyone else. The timetable and the Homework tile are how
students find out. This design adds nothing to `queue_workspace_email()` or
`email_reply_routes`.

## Year switch, leavers and imports

- **Nova-T class import:** classes are matched and updated in place, so
  homework stays attached. If a class is deleted, `class_id` becomes null and
  the homework keeps its subject and class code for the record.
- **Students changing set:** their marks stay under the old homework. They
  see the new class's homework from the moment `student_class` changes.
- **Leavers:** the login is locked (migration 251). Their marks are kept,
  readable by those allowed to see the class's grades.
- **Next year:** homework carries `academic_year_id`. Once the switch has
  run, students see only the current year's homework and grades (the
  principal's decision). Last year's stay in the database for staff: the
  class's teachers (while the class exists), the HoD, SMT and admin, and the
  grade history.
- **Backup mode:** new tables carry `a_backup_mode_guard`, so teachers can't
  save during a backup, as elsewhere.

## Order to build it in

1. **Migration 278:** the tables, helpers, triggers, policies, grants, the
   seed schemes, the `/homework` resource and its role permissions, and the
   `log_grade_change()` branch.
2. **`/homework`:** set, list and edit homework, then the mark book and
   Release.
3. **Student timetable:** the week selector, chips and panel, then the
   Homework tile's by-day grid, with its overdue and recently graded lists.
4. **`/homework/overview`** for HoDs and SMT.
5. **Report-writing hint** on `/reports/write-subject-comments`.
6. **Staff timetable** marker, the Lookups card, and the Grade History filter.
7. Update `docs/SYSTEM_RULES.md`, the Functional Specification and the PRD,
   and regenerate `sql/CURRENT_SCHEMA.md`.

**Test before release**, signed in as each role:

- A teacher sets homework and marks it for their own class, but is refused
  for another class, including by an edited request.
- A single-lesson override teacher can set homework for that class.
- A HoD can act in their department only.
- A student sees their own classes' homework, and their own grade only after
  release, never a classmate's, and not for homework whose year isn't
  current. Test this by giving a test homework a planning year's
  `academic_year_id`.
- A parent login gets nothing from `homework`, `homework_marks` or
  `my_homework()`.
- A mentor, a pastoral member of staff and an assessment manager can read
  homework tasks but get no marks, including from `grade_history`.
- A HoD's overview shows only their department. SMT's shows all.
- The report-writing hint appears for the class's own teacher and not for
  anyone else.
- Withdrawn homework disappears for students.
- A grade outside the scheme is refused.
- Every mark change appears in the grade history.

## Decided (the principal, 30 September 2026)

1. **Parents:** no. Parents don't see homework or homework grades.
2. **Staff visibility:** no, not all staff. Grades are visible only to the
   class's teachers, the Head of Department, SMT and admin. Homework tasks
   (without grades) stay readable by all staff.
3. **Notifications:** no. No inbox notices or emails.
4. **Oversight:** yes. HoDs and SMT get `/homework/overview`, and HoDs can
   set and edit homework in their department.
5. **Reports:** yes. The report-writing page shows the teacher a hint of the
   student's homework record. The report's homework grade is still typed by
   the teacher, and homework grades never feed a report automatically.
6. **Past years:** no. After the year switch, students see only the current
   year's homework and grades.
7. **Online hand-in:** not yet. It is left out of this build. When it comes,
   it will need a private storage bucket and its own design pass (files from
   students raise safeguarding questions). Nothing above has to change for
   it.

## Changes after the pilot started (the principal, 30 September 2026)

- **Marks follow the student (291).** A student who changes class or teacher
  keeps their marks in view: whoever teaches them in that subject now can read
  all their homework marks in it for the current school year, from any class.
  The teacher who gave the marks, the Head of Department, SMT and admins still
  see them. Students already saw their own released marks after a move.
- **Reports use homework (291), replacing decision 5.** While writing a
  subject comment the teacher sees each student's homework for the report
  period's term in that subject (any class): average of number-marked work,
  its grade from the subject's boundaries, how many were marked and how many
  weren't handed in. The Homework judgement is pre-filled from the average
  (80%+ Excellent, 60–79 Good, 40–59 Satisfactory, under 40 Needs
  Improvement) and the teacher can change it. Checkers assigned to the period
  see the same. All marks recorded for homework due in the term count,
  released or not; Not handed in is counted, not averaged as zero.
- **The printed report shows the grade only**, e.g. "Homework: B", in place
  of the judgement where there are homework marks; otherwise the teacher's
  judgement. The principal first chose to print the average too, then
  changed it to the grade alone. This is the one thing parents now see from
  homework (decision 1 otherwise stands).
