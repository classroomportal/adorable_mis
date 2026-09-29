# Admissions and moving up a year (2027/28): design

Status: design only, 29 September 2026. Nothing here has been built yet.
Revised the same day, twice, with the principal's answers on admissions, fees,
options, retention and when the switch happens. Open questions are at the end.

This covers four things that all have to be ready before September 2027:

1. **Admissions.** The paid admission form, a fixed test date, entrance tests
   (English and Maths, a different paper for each year group, plus CAT4), the
   posted result, the oral interview (interests and reading age), the school
   the child is coming from, the offer, and the school's standard letters.
2. **Moving up.** For each current student, decide what happens next year:
   move up, repeat, change year, or leave (including which Year 11s go on to
   Year 12).
3. **Subject choices.** Y9 choose options, and students going into Y12 drop
   one subject. Formwork collects both, and the results go to Nova-T.
4. **Next year's timetable.** Import the 2027/28 Nova-T timetable *before* the
   summer and map students into it. The whole school then switches over
   automatically, in one step, at the start of the new year's first term.

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

### How the school runs it (confirmed by the principal, 29 Sept 2026)

- **Entry is possible into any year, 7 to 12.**
- **Every student boards.** There are no day students, so no boarding/day field.
- **The family pays for the admission form.** Only after that is a test date
  fixed.
- **The tests:** English and Maths, **a different paper for each year group**,
  plus **CAT4**.
- **The pass mark is a 50% average** of English and Maths.
- **After the test,** the result is posted on the system. The applicant is then
  invited to the oral interview, rejected, or put on the waiting list.
- **At the oral interview,** interests are collected and reading age is
  measured. Reading age uses an **older paper-based test, not NGRT**.
- **Admissions staff make offers** by letter, using the school's **standard
  letters**.

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
  previous_school_id      → previous_schools
  previous_school_year    text               -- 'Year 6', 'Primary 6', 'JSS1' …
  sibling_student_id      → students (nullable), family_id → families (nullable)
  heard_about_us          text
  form_fee_paid_on date, form_fee_amount numeric, form_fee_receipt text,
  form_fee_recorded_by (stamp_actor)   -- recorded by the bursar
  session_id              → admission_sessions   -- the test date fixed for them
  status                  text               -- see pipeline below
  application_date        date
  decision_notes, decided_by (stamp_actor), decided_at
  accepted_at, withdrawn_reason
  student_id              → students         -- set when enrolled
  created_by, created_at, updated_at

applicant_contacts
  applicant_id, name, relationship, email, phone, is_primary,
  parent_id → parents (nullable)   -- when the family is already at the school

admission_papers          -- one English and one Maths paper per year group per entry year
  paper_id pk, academic_year_id, year_group int, subject text ('english' | 'maths'),
  paper_name text, max_score numeric
  unique (academic_year_id, year_group, subject)

admission_sessions        -- a test day
  session_id pk, academic_year_id, session_date, venue, notes

admission_test_scores     -- English and Maths
  applicant_id, paper_id → admission_papers, score numeric,
  entered_by (stamp_actor), entered_at
  unique (applicant_id, paper_id)

admission_cat4            -- same shape as cat4_results, so it copies across at enrolment
  applicant_id pk, test_date, level, verbal_sas, quantitative_sas,
  non_verbal_sas, spatial_sas, mean_sas, profile, entered_by (stamp_actor)

applicant_interviews      -- the oral interview
  applicant_id pk, interviewed_on, interviewer_staff_id
  reading_age_months int     -- from the paper-based reading test
  reading_test_name text     -- defaults to the school's test
  interests text[]           -- chosen from a fixed list + free text
  interests_other text
  languages_spoken text, strengths text, concerns text
  recommendation text        -- 'offer' | 'waitlist' | 'reject'
  comments text
```

**Each paper's `max_score` is recorded**, so every score becomes a percentage,
and papers with different totals in different years still compare. The
**test average** is the mean of the English and Maths percentages. It is
calculated rather than stored, and it is marked as passing at **50% or
above**. The pass mark is held in one setting in case it ever changes. It only
*suggests* the next step: admissions staff still choose invite, waiting list
or reject, so someone at 48% with a strong CAT4 can still be invited.

**CAT4 is copied to `cat4_results` at enrolment.** A new student then arrives
with their CAT4 profile already on `/students/[id]`, in the same place as
everyone else's.

**Reading age is stored in months**, and the page shows it as "11 y 4 m". The
page also shows the child's age on the interview day and the gap between the
two, since that gap is what the number is for. Reading age is recorded with
the interview because that is when it is measured.

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
enquiry → form_paid → test_booked → tested ─┬→ invited_to_interview → interviewed ─┬→ offered → accepted → enrolled
                                            ├→ waitlisted ─────────────────────────┤
                                            └→ rejected                            ├→ waitlisted
                                                                                   └→ rejected
            any stage → withdrawn (by the family)
```

- **The bursar records the form fee** at `/bursar/admission-forms`, using
  `record_admission_form_fee(applicant_id, paid_on, receipt)`. The function
  checks the caller is the bursar (or admin). The amount is the fixed fee for
  that entry year, `academic_years.admission_form_fee`, so it isn't typed in
  each time. The bursar's page shows only names, entry year and group,
  contacts and payment, never test scores or interview notes. Recording the
  payment moves the applicant from `enquiry` to `form_paid`.
- **`test_booked` needs the form fee recorded.** No test date can be fixed
  for an unpaid form.
- **`tested`** is reached once English, Maths and CAT4 are all entered.
- **Posting the result** means choosing `invited_to_interview`, `waitlisted`
  or `rejected`. The page shows the average against the pass mark. Posting
  produces the matching standard letter.
- **After the interview,** the applicant is `offered`, `waitlisted` or
  `rejected`, again with a letter. Someone on the waiting list can later be
  invited or offered.

Every status change is logged, with who made it.

### Standard letters

```
admission_letter_templates
  letter_kind pk  -- 'test_date', 'invite_to_interview', 'waitlist_after_test',
                  -- 'reject_after_test', 'offer', 'waitlist_after_interview',
                  -- 'reject_after_interview'
  subject text, body text   -- with merge fields
  updated_by (stamp_actor), updated_at

applicant_letters          -- what was actually sent, kept as sent
  letter_id pk, applicant_id, letter_kind, subject, body (merged text),
  sent_by (stamp_actor), sent_at, emailed_to text, email_outbox_id
```

- **The templates are the school's own standard letters.** They are typed in
  once and edited at `/admissions/letters`.
- **Merge fields** include `{{child_first_name}}`, `{{child_full_name}}`,
  `{{parent_name}}`, `{{entry_year}}`, `{{year_group}}`, `{{test_date}}`,
  `{{test_venue}}`, `{{interview_date}}` and `{{today}}`.
- **Sending a letter** does all of the following:
  - creates a PDF on school letterhead (`jspdf` is already used for
    transcripts), for printing or attaching;
  - emails it to the primary contact through `queue_workspace_email()`, with
    `'reply_to', email_reply_to('admissions')` and a new
    `email_reply_routes` row for admissions;
  - saves the merged text in `applicant_letters`, so there is a permanent copy
    of exactly what the family was told, even if the template changes later.
- **Status and letter go together.** Posting a result or making an offer does
  both in one step, so an applicant can't be marked `offered` without the
  offer letter being produced.

### Pages (new Admissions tile)

- `/admissions`: the pipeline by entry year and year group, with counts at
  each stage and a filter.
- `/admissions/new` and `/admissions/[id]`: the application, contacts, form
  fee, test scores and average, CAT4, interview and reading age, decision,
  letters sent, and history.
- `/admissions/sessions`: test days. Fix dates, book paid applicants onto
  them, print the list, and enter English, Maths and CAT4 for everyone in one
  grid after the tests.
- `/admissions/papers`: the English and Maths paper (and its maximum score)
  for each year group.
- `/admissions/letters`: the standard letter templates.
- `/admissions/schools`: previous schools, with merging of duplicates.

### Enrolment: from applicant to student

`enrol_applicant(applicant_id)` is a `SECURITY DEFINER` function. It checks
that the caller holds `admissions` or `admin`, and it only works on an
`accepted` applicant. It:

1. creates the `students` row with `year_group = entry_year_group`,
   `admission_date` = the start of the entry year, a UPN from
   `generate_next_upn()`, and `previous_school_id`;
2. copies CAT4 into `cat4_results`;
3. links each contact to an existing `parents` row (by `parent_id` if already
   set, never by guessing from email) or creates one, and adds `student_parent`;
4. sets `applicants.student_id` and `status = 'enrolled'`.

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

A student admitted **during the year**, into the current year, is enrolled
straight as `active`, with an admission date of their first day.

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

Decisions are made during the Summer term and can be changed right up until
the switch. Y11 decisions often depend on IGCSE results, which arrive in
August, before the September switch. A Y11 can be marked *provisional* until
then, and the readiness check lists any that are still provisional. A change
after the switch is just an ordinary edit (change the year group, or set a
leaving date).

Swapping a student into a different year (the "change_year" outcome) is the
same thing as moving up, with a year group chosen by hand. It then goes
through the same mapping as everyone else.

## Decision 4b: choosing next year's subjects (Y9 options, Y11 → Y12 drop)

The principal confirmed that Y9 students **choose options** for Year 10, and
that students going into Year 12 **drop one subject**. *Our reading of that:*
they keep their Year 11 subjects except one, which they pick. Please correct
this if Y12 works differently.

Formwork collects the choices. They then have to go to Nova-T, because the
timetabler builds next year's option blocks *from* the choices. So this
happens in the **Spring term**, before the Nova-T timetable is built.

```
subject_choice_rounds
  round_id pk, academic_year_id (the year being chosen FOR)
  from_year_group int           -- 9 or 11
  kind text                     -- 'choose' (Y9) | 'drop_one' (Y11)
  opens_at, closes_at timestamptz
  number_to_choose int          -- 'choose' only
  number_of_reserves int        -- 'choose' only
  instructions text

subject_choice_offer            -- 'choose' rounds: the subjects on offer
  round_id, subject_id, capacity int (nullable), notes

subject_choices
  round_id, student_id, subject_id,
  preference int                -- 1..n, then reserves after number_to_choose
  is_drop boolean               -- 'drop_one' rounds: the subject dropped
  chosen_by (stamp_actor), chosen_at
  unique (round_id, student_id, subject_id)
```

- **Y9 options.** Students choose in the student portal while the round is
  open, like Other Half choices (`choose_other_half_activity()`). A function,
  `submit_subject_choices()`, checks the window, the student's year group and
  the number of subjects. Mentors, HoDs and admin can enter or change choices
  for a student. After the window closes, only admin and the assessment
  manager can change them.
- **Y11 → Y12, drop one.** Each student sees their current examined subjects,
  worked out from their Year 11 classes (`student_class` → `classes.subject_id`,
  leaving out Mentor, Prep, Sports and Other Half), and picks one to drop.
  The rest carry on. This only applies to students whose progression
  (Decision 4) is `move_up` into Year 12.
- **`/admin/next-year/choices`** shows who hasn't chosen, the numbers for each
  subject (against capacity), and the popular combinations. That last view is
  what the timetabler needs to build the blocks. It **exports a CSV for
  Nova-T**: UPN, name and chosen subjects (their Nova-T `subject_code`).
- **After the Nova-T plan import,** the choices place students automatically
  (Decision 5). A Y10 student who chose Geography goes into the plan class
  for Geography in whichever option block holds it. If Geography runs in more
  than one block, or the student ended up with a reserve, they're left for a
  person to place. For Y12, each subject kept follows the student into the Y12
  plan class for that subject, and the dropped one is left out.

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
  (Choice 1/2, Pathway). These come from the students' subject choices
  (Decision 4b). Anyone the choices can't place is left for a person, in
  block allocation in plan mode.
- **Incoming students.** Their compound "Class" group comes from their form
  class. Sets are placed by hand, and entrance test scores are shown next to
  each name to help with Maths and English setting.
- **Students changing year.**

**Readiness check.** `next_year_readiness()` returns everything that would
stop a clean switch:
- students with no progression decision;
- Y9 and Y11 students with no subject choices;
- students with no class in a block of their new year group;
- plan classes with no teacher or no lessons;
- accepted applicants who haven't been enrolled;
- incoming students with no form class;
- mentor groups that don't exist yet.

The mapping page and `/admin/next-year` show this list. The automatic switch
waits, and emails the list, while anything on it is still open (Decision 6).

## Decision 6: the switchover happens automatically at the start of term

The principal's requirement: **the switch happens by itself at the start of
the new year's first term.** Moving up is planned beforehand, in Decisions
4–5, while the current year carries on unchanged.

### When it runs

`academic_years` gets `switch_at timestamptz`. By default it is **18:00 Lagos
time on the evening before the new year's first term starts**, the evening
the boarders arrive (`terms.start_date` minus one day, using `school_today()`
and `school_now()` because the database clock is UTC). That way houseparents
see the new year groups and mentor groups when the students arrive, and
teachers have next year's registers on the first morning. An admin can move it
at `/admin/next-year` if the arrival day is different. Until then, the old year's timetable stays live through the
summer, which does no harm while school is closed.

A `pg_cron` job, `academic-year-switch`, runs every 15 minutes. It does
nothing unless a `planning` year has `switch_at <= now()` and hasn't been
switched yet. When one has:

- **If the readiness check (Decision 5) is clear,** it switches. Admin and SMT
  get an email summary: numbers moved up, left, joined and allocated.
- **If anything is still open, it does not switch.** It emails admin and SMT
  the list and tries again on its next run, so fixing the last problem is
  enough to set it going. A partial switch would put some students in the
  wrong year's registers on the first morning, which is worse than a short
  delay. Admins also have a **Switch now** button, with the same checks, for
  an early or late switch.

### Warnings beforehand

So problems are found in the summer and not on the first day:

- **Reminders at 21, 14, 7, 3 and 1 day(s) before `switch_at`.** Each one is
  an email to admin and SMT with the readiness list and a **dry-run** summary:
  what the switch would do if it ran now.
- **`/admin/next-year`** shows the same information at any time: the
  countdown, the readiness list and the dry run.

Emails go through `queue_workspace_email()` with
`email_reply_to('year_rollover')`, and a new row in `email_reply_routes`.

### What the switch does

`perform_academic_year_switch(p_to_year_id, p_dry_run)` does the work. It is
`SECURITY DEFINER` with `revoke execute … from public, anon, authenticated`,
so only cron (and the wrapper below) can call it. The admin-facing
`switch_academic_year_now()` checks `is_admin()` and then calls it. It runs in
**one transaction**, so either everything happens or nothing does.

1. **Archive this year.** Copy `classes`, `timetable_slots`,
   `curriculum_blocks` and `student_class` into `archive_*` tables stamped with
   `academic_year_id`, keeping the original IDs. That keeps "who taught this
   child Maths in 2026/27" answerable, which nothing records today.
2. **Keep behaviour events' class.** Deleting a class sets
   `behaviour_events.class_id` to NULL. Add a `class_code` snapshot column,
   filled on insert by trigger and backfilled, so the event still says which
   class it was.
3. **Leavers** (`outcome = 'leave'`): set `leaving_date` = the end date of the
   old year and `status = 'left'`. The existing triggers remove their class
   links and lock their logins.
4. **Replace the live timetable.** Delete the live `student_class`,
   `timetable_slots`, `classes` and `curriculum_blocks`, then insert the plan
   rows with new IDs, carrying a map from plan ID to new ID.
5. **Move students.** Set `year_group` and `form_class` from their progression
   (the new mentor groups are created first because of the `form_class` FK).
   Remove mentor groups that are now empty.
6. **Incoming → active.** This unlocks their logins and makes them visible to
   their parents.
7. **Change the year:** mark 2026/27 `closed` and 2027/28 `current`, and
   create a new `planning` row for 2028/29 so that year's admissions can
   start. Then clear the plan tables.

Everything is written with `formwork.change_note = 'Automatic year switch'`
(or the admin's name if they pressed Switch now), and to a new
`change_history` area, `year_rollover`.

### Before it is trusted

- **Test it on a Supabase branch** (a copy of the database) first:
  - run the dry run there, then the real run;
  - then check registers, `registers_not_done`, timetables and block
    allocation the way a teacher and a Head of Department would use them.
- **Take the backup** in `docs/BACKUP_POLICY.md` the day before `switch_at`.

## Security, permissions and logging (following CLAUDE.md)

- Every new table: RLS on, with explicit `grant … to authenticated` for only
  the verbs its policies allow.
- **Applicant data is children's personal data**, from families who may never
  join the school. Reading and writing is limited to `has_resource_access('/admissions')`
  (admissions, SMT, admin by default), not "any staff". Interview notes and
  decisions can be limited further if the school wants. The bursar's form-fee
  page goes through a function that returns only the fields it needs.
- **Retention: kept indefinitely for now** (the principal's decision,
  29 Sept 2026). Nothing is deleted automatically. The Nigeria Data Protection
  Act 2023 expects personal data to be kept no longer than needed, so
  unsuccessful applicants' records are built to be anonymised in one step
  (`anonymise_applicant()`): the name, contacts, date of birth and notes are
  removed, and the entry year, year group, previous school and scores are
  kept for statistics. That way a retention period can be added later
  without redesigning anything.
- `decided_by`, `entered_by`, `sent_by`, `form_fee_recorded_by` and
  `created_by` are stamped by `stamp_actor()`, never taken from the page.
- **Admissions staff can post results and make offers themselves.** The
  status change and its letter happen in one `SECURITY DEFINER` function,
  `post_admission_decision(applicant_id, new_status, notes)`, which checks
  `has_resource_access('/admissions')`. The browser can't set `status` on
  `applicants` directly, so it can't skip the letter or the log.
- New `change_history` areas: `admissions` (status changes on `applicants`,
  and test score, CAT4 and interview changes after they are first entered)
  and `year_rollover`.
- Plan tables: written by `can_allocate_classes()` (admin, HoD, pastoral, as
  for block allocation today) and readable by all staff. The switch itself is
  admin only.
- New resource keys: `/admissions`, `/admissions/sessions`,
  `/admissions/papers`, `/admissions/letters`, `/admissions/schools`,
  `/bursar/admission-forms`, `/admin/next-year`,
  `/admin/next-year/progression`, `/admin/next-year/choices`,
  `/admin/next-year/mapping`.
- No `app/api` routes are needed. Everything is RLS plus
  `SECURITY DEFINER` functions that check the caller first.

## Order to build it in

Admissions testing for September 2027 will start well before the timetable
work, so admissions comes first.

| Phase | What | Needed by |
|---|---|---|
| 1 | `academic_years`; applicants, form fee, previous schools; papers per year group; test days and the English/Maths/CAT4 grid; posting results with standard letters; interview and reading age; offers | before the first test day |
| 2 | `incoming` status: audit the student queries, `enrol_applicant()` (including the CAT4 copy), locked logins | before the first offers are accepted |
| 3 | Subject choice rounds: Y9 options and Y11 drop-one, in the student portal; `/admin/next-year/choices`; export for Nova-T | Spring term 2027, before the timetabler blocks options |
| 3b | `student_progressions` and its page | Summer term 2027 |
| 4 | Plan tables; plan mode on the Nova-T import, block allocation, UPN/Class import and timetable views; mapping; readiness check | when Nova-T 2027/28 is ready (June/July 2027) |
| 5 | Archive tables, behaviour class snapshot, the switch function, the `academic-year-switch` cron job and reminder emails, `/admin/next-year`; tested on a branch | end of Summer term 2027 |

## Answered (29 Sept 2026)

- **Entry:** into any year, 7–12. There is in-year entry too, which enrols
  straight as `active`.
- **Day students:** none; everyone boards.
- **Tests:** a different English and Maths paper for each year group, plus
  CAT4. The pass mark is a 50% average of English and Maths.
- **Process:** paid form → test date → result posted → interview, reject or
  waiting list.
- **Form fee:** recorded by the bursar. A fixed amount.
- **Reading age:** an older paper-based test, not NGRT.
- **Offers:** made by admissions staff, by letter, from standard letters. The
  principal will upload the letters.
- **Incoming status:** yes. Accepted applicants become `incoming` students.
- **Retention:** keep indefinitely for now; anonymising is built in, for later.
- **Options:** Y9 choose options for Y10. Going into Y12, students drop one
  subject.
- **Switch:** automatic, on the evening the boarders arrive, with moving up
  planned before.

## Open questions

1. **The standard letters:** waiting for the principal to upload them. Is
   there anything the family must return with the offer (acceptance form,
   deposit)? That decides what marks an applicant `accepted`.
2. **Y12 "drop one subject":** is our reading right (keep Year 11's subjects
   except one)? And how many options do Y9 choose, with how many reserves?
3. **Anything else from the application or interview:** for example previous
   school reports, medical or SEN notes, or fee sponsor.
4. **The form fee amount** for 2027/28 entry.
