# Admissions and moving up a year (2027/28): design

Status: design only, 29 September 2026. Nothing here has been built yet. The
open questions at the end need answers before the schema is written.

This covers three things that all have to be ready before September 2027:

1. **Admissions.** Applications, entrance tests (English and Maths), the oral
   interview (interests and reading age), the school the child is coming from,
   and the decision.
2. **Moving up.** For each current student, decide what happens next year:
   move up, repeat, change year, or leave (including which Year 11s go on to
   Year 12).
3. **Next year's timetable.** Import the 2027/28 Nova-T timetable *before* the
   summer, map students into it, and then switch the whole school over in one
   step.

## What exists today (checked against the live database, 29 Sept 2026)

- **There is no academic year anywhere.** `classes`, `timetable_slots`,
  `curriculum_blocks`, `student_class` and `mentor_groups` hold only the
  current year. `terms` has no year. The only `academic_year` is a text column
  on `fee_terms` (`'2026/27'`). Nothing has ever increased
  `students.year_group`: this year's move-up was done by hand or by re-import.
- **Active students:** Y7 49, Y8 46, Y9 38, Y10 61, Y11 50, Y12 33 (277).
  Year 12 is the final year (WAEC). Y11 has 9 mentor groups and Y12 has 3, so
  mentor groups can't simply follow a group up from 11 to 12.
- **Class codes carry the year:** `7a/Ma1`, `8GIR/Pe`, `10_1/Ma`, `11X/Ex`,
  `12U/Me`. `app/admin/import-classes` (the Nova-T import) takes the year group
  from the leading digits and **matches classes by `class_code`**, or by
  content when a code has been renamed. When it finds a match it updates the
  teacher, room and lessons in place.
- **Blocks:** Y7–9 are a whole-class compound block ("Class") plus sets (Maths,
  PE, Prep, Sports). Y10–11 add Option, MFL, Pathway and Vocational. Y12 has
  Choice 1 and Choice 2.
- **History doesn't depend on classes.** `attendance` and `results` hold
  student, subject and date, not `class_id`. The only other table that
  references `classes` is `behaviour_events.class_id`, and it is `ON DELETE
  SET NULL`. So a year's classes can be retired without losing registers or
  marks. Deleting them does lose which class a behaviour event happened in
  (see "Switchover").
- **Admissions:** there is an `admissions` staff role (6 holders). It has no
  admissions pages, only general ones. There is no applicant data.
  `students.admission_number` and `admission_date` exist, and
  `generate_next_upn()` issues UPNs. There is no previous-school field.
- **Students' status** is only ever `active` or `left`. Moving away from
  `active` removes class links (migration 108/150) and locks the login
  (migration 251). Parents only see `active` children (migration 255).

### The problem that drives the design

Next year's Y8 timetable will have a class called `8a/Ma1`, and so does this
year's. If the 2027/28 Nova-T file were run through the current importer in
June, it would **overwrite this year's Y8 timetable while it is still being
taught**: same codes, new teachers and rooms, lessons retagged. And until the
day of the switch, next year's `8a/Ma1` has to hold this year's *Y7* students,
while this year's `8a/Ma1` still holds this year's Y8s.

So next year's timetable has to live somewhere other than the live tables
until the day the school changes over.

## Decision 1: academic years become a real thing

```
academic_years
  academic_year_id  serial pk
  label             text unique        -- '2026/27'
  start_date, end_date date
  status            text               -- 'planning' | 'current' | 'closed'
  -- partial unique index: exactly one row with status = 'current'
```

Seed `2026/27` (current) and `2027/28` (planning). Add
`terms.academic_year_id`, and backfill the three existing terms.
`fee_terms.academic_year` stays text for now (the bursar's pages read it), with
a check that it matches a label.

Everything else keeps meaning "the current year", as it does today.

## Decision 2: next year is planned in separate "plan" tables, not the live ones

```
plan_curriculum_blocks   (same columns as curriculum_blocks + academic_year_id)
plan_classes             (same columns as classes + academic_year_id)
plan_timetable_slots     (same columns as timetable_slots)
plan_student_class       (student_id, plan_class_id, block_id, is_compound)
plan_mentor_groups       (group_name, year_group, academic_year_id)
```

**Why not add `academic_year_id` to the live tables instead?** About 12 pages
and several views/functions (`registers_not_done`, `capture_register_alerts`,
timetables, class lists, block allocation) read `classes`, `timetable_slots`
and `student_class` with no year filter. Every one of them would need one, and
any one missed would put next year's lessons into today's registers or next
year's classes on today's timetable. That kind of bug would only show up in
June, when next year's data appears. Separate tables mean nothing that runs
the school day can see the plan, and the only code that changes is the code
built for planning.

The existing pages are reused in "plan" mode rather than rewritten:

- **Nova-T import** (`/admin/import-classes`): a "Year: 2026/27 (live) /
  2027/28 (plan)" switch picks which set of tables it reads and writes. The
  parsing (codes, subjects through `subjects.subject_code`, skipping `Oh`/`Sa`,
  per-lesson teacher and room) is unchanged.
- **Block allocation** (`/admin/block-allocation`) and the **UPN/Class import**
  (`/admin/import-timetable`) get the same switch. In plan mode they list
  students by *next year's* year group, taken from their progression decision.
- **Timetable viewer / print timetables**: a plan-mode view so staff and HoDs
  can check next year before it goes live.

## Decision 3: admissions

### Tables

```
previous_schools
  school_id pk, name, town, state, country,
  curriculum text     -- 'British', 'Nigerian', 'American', 'IB', 'Other'
  unique (lower(name), lower(coalesce(town,'')))

applicants
  applicant_id pk
  first_name, middle_name, last_name, preferred_name, dob, gender, nationality
  entry_academic_year_id  → academic_years   -- '2027/28'
  entry_year_group        int check 7..12
  boarding                text               -- 'boarder' | 'day'
  previous_school_id      → previous_schools
  previous_school_year    text               -- 'Year 6', 'Primary 6', 'JSS1' …
  sibling_student_id      → students (nullable), family_id → families (nullable)
  heard_about_us          text
  status                  text               -- see pipeline below
  application_date        date
  decision, decision_notes, decided_by (stamp_actor), decided_at
  offer_sent_at, accepted_at, withdrawn_reason
  student_id              → students         -- set when enrolled
  created_by, created_at, updated_at

applicant_contacts
  applicant_id, name, relationship, email, phone, is_primary,
  parent_id → parents (nullable)   -- when the family is already at the school

admission_sessions        -- a test day
  session_id pk, academic_year_id, session_date, venue, notes

admission_assessments     -- one row per applicant per component
  applicant_id, component text    -- 'english' | 'maths' | 'reading_age' | 'interview'
  session_id (nullable), assessed_on date, assessed_by (stamp_actor)
  score numeric, max_score numeric           -- English, Maths
  reading_age_months int                     -- reading age, stored in months
  notes
  unique (applicant_id, component)

applicant_interviews
  applicant_id pk, interviewed_on, interviewer_staff_id
  interests text[]           -- chosen from a fixed list + free text
  interests_other text
  languages_spoken text, strengths text, concerns text
  recommendation text        -- 'strong' | 'accept' | 'borderline' | 'decline'
  comments text
```

**Reading age is stored in months**, and the page shows it as "11 y 4 m". The
page also shows the child's age on the test day and the gap between the two,
since that gap is what the number is for. The chronological age comes from
`dob` and `assessed_on`, so it isn't stored.

**Interests use a fixed list** (sport, music, drama, art, debating, STEM
clubs, and so on) plus free text, because a list can be counted and searched.
After the child arrives, their interests are shown on `/students/[id]` and to
the Other Half coordinator, so they can be pointed at activities in their
first term.

**Previous school is a lookup, not free text.** "Corona School", "Corona Sch,
Ikoyi" and "corona school ikoyi" would otherwise be three schools, and
"which schools do our students come from, and how did they do in our tests" is
a question the school will want answered. The school is carried onto
`students.previous_school_id` at enrolment (a new column), so it stays on the
student record afterwards.

### Pipeline

```
enquiry → applied → test_booked → tested → interviewed → offered → accepted → enrolled
                                         ↘ waitlisted
            any stage → declined (by school) | withdrawn (by family)
```

The status moves forward when the right data is saved (for example, recording
English and Maths results moves an applicant to `tested`). It can also be set
by hand, and every change is logged. `offered` and `declined` need a decision
by SMT or an admissions lead, not by whoever typed in the scores.

### Pages (new Admissions tile)

- `/admissions`: the pipeline by entry year and year group, with counts at
  each stage and a filter.
- `/admissions/new` and `/admissions/[id]`: the application, contacts, test
  scores, reading age, interview, decision and history.
- `/admissions/sessions`: test days. Book candidates, print the list, and
  enter everyone's scores in one grid after the tests.
- `/admissions/schools`: previous schools, with merging of duplicates.
- Later: offer letters by email through `queue_workspace_email()`, with
  `email_reply_to('admissions_offer')` and its own `email_reply_routes` row.

### Enrolment: from applicant to student

`enrol_applicant(applicant_id)` is a `SECURITY DEFINER` function. It checks
that the caller holds `admissions` or `admin`, and it only works on an
`accepted` applicant. It:

1. creates the `students` row with `year_group = entry_year_group`,
   `admission_date` = the start of the entry year, a UPN from
   `generate_next_upn()`, and `previous_school_id`;
2. links each contact to an existing `parents` row (by `parent_id` if already
   set, never by guessing from email) or creates one, and adds `student_parent`;
3. sets `applicants.student_id` and `status = 'enrolled'`.

The recommended status for the new student is **`incoming`**: they are
admitted for next year but not here yet. That gives the bursar a real student
to invoice for Term 1 and gives the planners a student to put into next year's
classes, while keeping them out of this year's registers (which work through
`student_class`). Parents of incoming students don't see the portal yet,
because migration 255 shows only `active` children. **Cost:** about 20 of the
66 student queries in `app/` don't filter by status, including tuckshop,
clinic and some bursar lists. Those queries show leavers today and would show
incoming students too. Each one needs an explicit decision about which
statuses it lists. That audit is part of building this, not optional. The
student login should be created but kept locked (as for leavers, migration
251) until the student becomes `active`.

## Decision 4: next year's plan for each current student ("progression")

```
student_progressions
  student_id, academic_year_id (the year being moved INTO)   -- pk
  outcome text     -- 'move_up' | 'repeat' | 'change_year' | 'leave'
  to_year_group int (null when leaving)
  to_form_class text → plan_mentor_groups
  leaving_reason text, decided_by (stamp_actor), decided_at, notes
```

`/admin/next-year/progression` shows one year group at a time, with default
values filled in:

| Now | Default | Needs a person to decide |
|---|---|---|
| Y7–Y10 | move up one year, same mentor-group name ("7 George" → "8 George") | repeats, changes of year, leavers |
| Y11 | **undecided** | each student: continue to Y12 or leave |
| Y12 | leave (graduates) | a student staying on |

Y11 decisions will often depend on IGCSE results, which arrive in August,
after the switch. So a decision can stay provisional, and after the switch a
late change is just an ordinary edit (change the year group, or set a leaving
date).

Swapping a student into a different year (the "change_year" outcome) is the
same thing as moving up, with a year group chosen by hand. It then goes
through the same mapping as everyone else.

## Decision 5: mapping students into next year's classes

This is the step after the Nova-T plan import. It works at **class level** and
then **student level**, so most of it is automatic and the work left is only
the real choices.

**Class mapping, automatic.** For each current class, work out the code it
becomes: replace the year at the front with the year the class's students
move into. `7a/Ma1` becomes `8a/Ma1`, `10_1/Ma` becomes `11_1/Ma`, and
`8GIR/Pe` becomes `9GIR/Pe`. If a plan class with that code exists, it is
proposed as the mapping. This matches what already happens: Y7→8, Y8→9 and
Y10→11 are mostly "same set, one year up".

```
plan_class_mappings
  from_class_id → classes, to_plan_class_id → plan_classes,
  source text ('auto' | 'manual'), confirmed boolean
```

`/admin/next-year/mapping` lists, for each year group, the proposed mappings,
the classes with no match (on either side), and the students each one
carries. Staff confirm or correct them, then **Apply**, which fills
`plan_student_class` for every student whose outcome is `move_up` or
`repeat`. Students leaving are skipped.

**What can't be mapped by code, and is done by hand:**

- **Y9 → Y10 options** (Option, MFL, Pathway, Vocational) and **Y11 → Y12**
  (Choice 1/2, Pathway). These are new choices, not continuations. Use block
  allocation in plan mode, or import a UPN/Class file from Nova-T if options
  are blocked there.
- **Incoming students.** Their compound "Class" group comes from their form
  class. Sets are placed by hand, and entrance test scores are shown next to
  each name to help with Maths and English setting.
- **Students changing year.**

**Readiness check.** `next_year_readiness()` returns everything that would
stop a clean switch:
- students with no progression decision;
- students with no class in a block of their new year group;
- plan classes with no teacher or no lessons;
- accepted applicants who haven't been enrolled;
- incoming students with no form class;
- mentor groups that don't exist yet.

The mapping page shows this list, and the switch refuses to run while
anything on it is still open.

## Decision 6: the switchover

`switch_academic_year(p_to_year_id, p_dry_run boolean default true)` is admin
only: it checks `is_admin()` first. It runs in **one transaction**, so either
everything happens or nothing does. It is run in the summer holiday (after 10
July 2027, before the September term) and after the backup in
`docs/BACKUP_POLICY.md`. With `p_dry_run` it reports what it would do and
changes nothing.

1. **Archive this year.** Copy `classes`, `timetable_slots`,
   `curriculum_blocks` and `student_class` into `archive_*` tables stamped with
   `academic_year_id`, keeping the original IDs. That keeps "who taught this
   child Maths in 2026/27" answerable, which nothing records today.
2. **Keep behaviour events' class.** Deleting a class sets
   `behaviour_events.class_id` to NULL. Add a `class_code` snapshot column,
   filled on insert by trigger and backfilled, so the event still says which
   class it was.
3. **Leavers** (`outcome = 'leave'`): set `leaving_date` = the end date of the
   year and `status = 'left'`. The existing triggers remove their class links
   and lock their logins.
4. **Replace the live timetable.** Delete the live `student_class`,
   `timetable_slots`, `classes` and `curriculum_blocks`, then insert the plan
   rows with new IDs, carrying a map from plan ID to new ID.
5. **Move students.** Set `year_group` and `form_class` from their progression
   (the new mentor groups are created first because of the `form_class` FK).
   Remove mentor groups that are now empty.
6. **Incoming → active.** This unlocks their logins and makes them visible to
   their parents.
7. **Change the year:** mark 2026/27 `closed` and 2027/28 `current`, then
   clear the plan tables.

Everything is written with `formwork.change_note` set, and to a new
`change_history` area, `year_rollover`.

Test it first on a Supabase branch (a copy of the database). Run the dry run
there, then the real run, and then check registers, `registers_not_done`,
timetables and block allocation as a teacher and as a Head of Department
would use them.

## Security, permissions and logging (following CLAUDE.md)

- Every new table: RLS on, with explicit `grant … to authenticated` for only
  the verbs its policies allow.
- **Applicant data is children's personal data**, from families who may never
  join the school. Reading and writing is limited to `has_resource_access('/admissions')`
  (admissions, SMT, admin by default), not "any staff". Interview notes and
  decisions can be limited further if the school wants.
- `decided_by`, `assessed_by` and `created_by` are stamped by `stamp_actor()`,
  never taken from the page.
- New `change_history` areas: `admissions` (status and decision changes on
  `applicants`, and `admission_assessments` changes after they are first
  entered) and `year_rollover`.
- Plan tables: written by `can_allocate_classes()` (admin, HoD, pastoral, as
  for block allocation today) and readable by all staff. The switch itself is
  admin only.
- New resource keys: `/admissions`, `/admissions/sessions`,
  `/admissions/schools`, `/admin/next-year/progression`,
  `/admin/next-year/mapping`.
- No `app/api` routes are needed. Everything is RLS plus
  `SECURITY DEFINER` functions that check the caller first.

## Order to build it in

Admissions testing for September 2027 will start well before the timetable
work, so admissions comes first.

| Phase | What | Needed by |
|---|---|---|
| 1 | `academic_years`; admissions tables and pages; previous schools; test sessions and the score grid; interview; decisions | before the first test day |
| 2 | `incoming` status: audit the student queries, `enrol_applicant()`, locked logins | before the first offers are accepted |
| 3 | `student_progressions` and its page | Summer term 2027 |
| 4 | Plan tables; plan mode on the Nova-T import, block allocation, UPN/Class import and timetable views; mapping; readiness check | when Nova-T 2027/28 is ready (June/July 2027) |
| 5 | Archive tables, behaviour class snapshot, `switch_academic_year()`, tested on a branch | before the summer switch |

## Open questions

1. **Entry points.** Which year groups take new students: Y7 only, Y7 and Y10,
   or also Y12 (external sixth-form applicants)? Is there in-year admission
   (joining mid-year), which enrols straight into `active` rather than
   `incoming`?
2. **Tests.** Are English and Maths the same paper for every entry year, or one
   per year group? Score only, or also a grade or band? Is there a pass mark
   that should flag borderline candidates automatically?
3. **Reading age.** Which test is used (for example NGRT, which the school
   already records for current students in `ngrt_results`, or Salford or
   Suffolk)? If it's NGRT, the applicant's result could carry straight into
   `ngrt_results` at enrolment.
4. **Who decides?** Can the admissions staff make offers, or only SMT / the
   principal?
5. **Incoming students before September.** Is the `incoming` status right
   (invoiceable, placeable in next year's classes, invisible to registers and
   the parent portal)? Or should accepted applicants stay out of `students`
   until the switch, which means fees are handled outside Formwork until then?
6. **Retention.** How long are unsuccessful applicants kept? The Nigeria Data
   Protection Act expects a limit. We suggest deleting or anonymising them
   12 months after the entry year starts.
7. **Y9 options and Y12 choices.** Are they blocked in Nova-T (so a UPN/Class
   file comes out of it), or should Formwork collect the choices?
8. **Anything else from the interview or application** (the request was cut off
   after "School that they are coming from"): for example previous school
   reports, sibling at the school, boarding preference, medical or SEN notes,
   or fee sponsor.
