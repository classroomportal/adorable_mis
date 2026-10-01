# Student groups: design

Status, 1 October 2026: **all four stages built.** Stage 1 (migration 284):
groups, members, the staff who run them, `/groups` under Administration, the
Groups tile on a student's profile, and "Student group" as a message target.
Stage 2 (migration 285): groups built from a rule at `/groups/build`, with
every setting chosen each time (the principal: "system build parameters must
be editable"). Stage 3 (migration 287): mark sheets for a group, outside
reporting. Stage 4 (migration 300): a Groups tile on the student and parent
portals, listing only the groups marked to be shown. All the principal's
decisions are under "Decided".

What was asked for (the principal, 30 Sept 2026): "we need to create groups of
students sometimes for particular activities, sometimes for recording particular
marks, sometimes to send parents a message and sometimes we want the system to
create a group of students based on progress academically or poor behaviour or
for prefects."

So one kind of thing, a **student group**, used in four ways:

1. **Activities:** a trip, a club, a squad, a revision set, the prefects.
2. **Marks:** a mark sheet for the group (a sports trial, a reading test, a
   prefect interview), outside reporting.
3. **Messages:** write to the students, their parents or both, from
   `/comms/compose`, as for a year group or a class today.
4. **Built by the system:** "every Year 9 student on −6 or worse this term",
   "students below target in 3 or more subjects", as a dated list.

## Decided (the principal, 30 Sept 2026)

| Question | Decision |
| --- | --- |
| Who creates groups | **SMT, pastoral and the school office** (and admin). Teachers can use a group they are given, but can't make one. |
| Groups built by a rule | **A snapshot with a date.** The rule picks the students once; the group records the rule and the date ("Negative points −6 or worse, Year 9, as of 30 Sept 2026"). After that it is an ordinary list that doesn't change by itself. |
| Marks recorded for a group | **Outside reporting**, like homework: logged in Grade History, never used by reports, transcripts, result sets or target grades. |
| Who sees that a student is in a group | **Staff always. Students and parents only for groups marked to be shown** (e.g. Prefects, Debate Club). |

## What exists today (checked against the live database, 30 Sept 2026)

- **No groups of any kind** beyond the school's structure: year group, form /
  mentor group, boarding house, sports house, teaching class (`student_class`)
  and Other Half activity (`other_half_choices`). No table, page or function for
  ad-hoc groups; nothing mentions prefects.
- **Messages** already go to "a group of students" (migration 277):
  `message_group_students(target_type, values)` resolves year groups, forms,
  houses, mentor groups, sports houses, classes and OH activities to active
  students, and `send_message()` sends to the students, parents or both,
  emailing parents. Only smt, pastoral, school_office and admin can send
  (`user_has_staff_role()`), the same people who will create groups.
- **Behaviour:** points per event from the category; the current term is
  "September Term 2026" (21 Sept – 4 Dec). Thresholds live in
  `behaviour_rules` (migration 262), so a rule can offer them as defaults.
- **Academic progress:** 234 of 278 active students have target grades. The
  "below target" comparison already exists for display in `lib/gradeCompare.js`
  (`visibleTargets()` narrows targets to subjects the student is timetabled
  for). Term exams are one result set per year group (migration 246), found by
  `calendar_events.exam_year_group` / `exam_term`.
- **Homework** (migrations 278–281) is the model for "marks outside reporting":
  its own marks table, checked against a grading scheme, logged in
  `grade_history`, never read by reports.
- **Roles:** there are 15 smt, pastoral and school_office role assignments (some staff hold more than one).

## The design

### 1. Groups and members

- `student_groups`: name, description, **kind** (`activity`, `marks`, `intervention`,
  `leadership`, `other`, just a label to sort and filter by), **visibility**
  (`staff`, `students`, `students_and_parents`), academic year, created by, and
  for a rule-built group the rule and its settings, plus the date it was built.
  A group is **archived**, not deleted, once it is finished, so its marks and
  message history stay readable.
- `student_group_members`: one row per student, with who added them and when.
  Only active students can be added. A student who leaves stays in the list,
  marked as a leaver, and drops out of messages automatically (as today,
  migration 237).
- `student_group_staff`: the staff who **run** the group (the trip leader, the
  coach, the teacher marking the reading test). They can see its members, take
  its marks and message it only if their own role allows messaging. They can't
  change who is in it.
- **Who can create, rename, archive and change members:** smt, pastoral,
  school_office and admin (`can_manage_student_groups()`), checked in the
  database. Every membership change is logged permanently in `change_history`
  under a new area, `groups`.
- **Leadership groups** (prefects, head students) are ordinary groups of kind
  `leadership`, normally shown to students and parents.

### 2. Groups built by a rule (a dated snapshot)

At `/groups/new` the creator picks "Build from a rule", chooses the rule and its
settings, and sees the list **before** saving, with each student's reason
("−9 this term", "below target in Maths, Physics, English"). They can untick
students, then save. The group records the rule, its settings and the date.
**Build again** makes a new dated group from the same rule, so last month's list
and this month's sit side by side; the old one is never changed.

First rules (each can be narrowed by year group, form and house):

| Rule | Settings | Uses |
| --- | --- | --- |
| Negative behaviour | Points total at or below X over a period (this term, last 4 weeks, dates) | `behaviour_events`, withdrawn events excluded |
| Positive behaviour | Points total at or above X over a period | Rewards, certificates |
| Below target | Latest grade below target in N or more subjects | `results` + `target_grades`, as `lib/gradeCompare.js` |
| Term exam average | Average % in a term exam below or above X | Term exam result sets (migration 246) |
| Attendance | Attendance below X % over a period | `attendance` |

The rule runs in the database (`build_student_group_preview()`), not in the page,
so everyone gets the same answer, and a person without the right to create
groups can't run it.

### 3. Marks for a group (outside reporting)

- A group can have one or more **mark sheets**: a title, a date and a grading
  system taken from homework's (`homework_schemes`: Mark out of …, Percentage,
  A*–U, 9–1, Effort 1–4, Complete / Incomplete…), so there is one list of
  grading systems in the school.
- `group_marks`: one mark per student per sheet, checked against the grading
  system, only for members of the group.
- **Who records marks:** the group's staff and the people who can manage groups.
- **Who reads marks:** the same people, plus SMT. Not students or parents.
- Every mark entered, changed or deleted is logged in `grade_history`
  (`table_name = 'group_marks'`), like every other grade. Never read by reports,
  transcripts, result sets or target grades, and never written to `results`.

### 4. Messages

`/comms/compose` gets a new target, **Student group**, alongside year group,
form, class and so on. Several groups can be chosen at once, and the audience is
students, parents or both, exactly as for the other student groups (migration
277): parents are emailed, leavers are skipped, and "Check recipient count" shows
the real number. This is one new branch in `message_group_students()`.

### 5. Where groups show

- **`/groups`** (new, Pastoral or Administration tile): the list of groups with
  filters by kind, year and "mine"; each group's page shows members, staff, mark
  sheets, and buttons to message it or build it again.
- **A student's profile:** a Groups card listing every group they are in, for
  staff.
- **Student portal and parent portal:** a "Groups" line or card listing only the
  groups marked to be shown (and, for parents, only `students_and_parents`),
  and only for current children, as for every parent read (migration 255).

## Access, in one table

| Who | Create, edit, archive; change members | See members | Record marks | Read marks |
| --- | --- | --- | --- | --- |
| smt, pastoral, school_office, admin | Yes | All groups | Yes | Yes |
| A group's own staff | No | Their groups | Their groups | Their groups |
| Other staff | No | All groups | No | No |
| Students | No | Which of their own groups are shown to students (not the other members) | No | No |
| Parents | No | Which of their children's groups are shown to parents (not the other members) | No | No |

## Also decided (the principal, 30 Sept 2026: "go with your suggestion")

1. **Rule-built groups are always staff-only.** A list built from behaviour or
   progress can never be shown to students or parents (enforced by the
   `student_groups_rule_staff_only` check).
2. **All staff can see every group and its members**, like classes. Only the
   people who run a group, or manage groups, will see its marks.
3. **Students and parents don't see group marks** in the first version.
4. **No group register** in the first version. If one is added, it stays
   separate from the school `attendance` table.
5. **First rules:** negative behaviour and below target. The other three (positive behaviour, term exam average, attendance) followed on 1 Oct 2026 (migration 301, the principal: "build the other three group rules").
6. **The tile sits under Administration** (`/groups`, "Student Groups").

`/groups` is granted to smt, pastoral, school_office (who manage groups) and
teacher (who can look them up); other roles can be given it at
`/admin/permissions`.

## Build plan

1. **Phase 1 (built, migration 284):** groups, members, staff, `/groups`, the
   student profile card, messages to a group, change log. (Makes activities,
   prefects and messaging work.)
2. **Phase 2 (built, migration 285):** rule-built groups at `/groups/build`
   (preview, untick, save as a dated snapshot, build again with changed
   settings): negative behaviour and below target. Every setting is chosen
   each time; the form only starts from this term, this school year, −6
   points and 3 subjects.
   **Migration 301** added the other three rules: positive behaviour (points
   at or above a total between two dates), term exam average (one term
   exam, chosen by its date, below or at/above a percentage; a student is
   judged on the year-group set they sat, so last year's exams work) and
   attendance (present or late as a share of all marks between two dates,
   below a percentage, leaving out students with fewer than a chosen number
   of marks). Starting values: +40 points, the latest term exam below 50%,
   attendance below 90% over at least 20 sessions.
3. **Phase 3 (built, migration 287):** `student_group_mark_sheets` and
   `student_group_marks` on the group's page, with Grade History. "Absent" is
   allowed as well as "Not handed in" and "Excused", since group marks are
   often a test on the day.
4. **Phase 4 (built, migration 300):** a Groups tile on the student portal
   (and the student home page) and the parent portal, shown only when there
   is a group to list. It reads through `portal_student_groups(student_id)`,
   not through policies on the group tables, so a student learns which groups
   they are in but never who else is: name, description, kind and who runs
   it. Students see groups marked for students or for students and parents;
   parents only the latter, and only for current children; staff viewing as a
   parent get the parent's view. Archived groups, earlier school years and
   rule-built groups are never shown.

Each phase is one migration and its pages, with grants to `authenticated` only,
RLS on every table through `auth.uid()` helpers, and the `docs/SYSTEM_RULES.md`
and living docs updated with it.

## Placing a group in the Other Half (migration 302)

Asked by the principal on 1 Oct 2026: "choose a group of students who are
underneath a certain grade or below target in a subject and create a group
and then allocate them to the other half group and lock their choice in until
we decide or for a certain amount of time".

1. **Choose the students:** the "A subject" rule at `/groups/build`, i.e. the
   latest grade in one subject since a chosen date is below a chosen grade
   or below the student's target in it.
2. **Place them:** on the group's page, "The Other Half" puts every current
   student in the group into one activity, replacing their choice for that
   day only.
3. **Lock it:** until staff unlock it, until a date, or not at all. While the
   lock is in force the student can't change or clear that day.

Decided by the principal (same day):

| Question | Decision |
| --- | --- |
| Who places and locks | Those who manage the Other Half (smt, other_half, admin) and those who manage groups (pastoral, school_office) |
| What students and parents see | "Placed by the school" and the end date, never why |
| When the lock ends | The student stays in the activity and may change it at Evening Prep while choices are open |
| A full activity, or outside a student's year group | A warning, then it goes ahead |
