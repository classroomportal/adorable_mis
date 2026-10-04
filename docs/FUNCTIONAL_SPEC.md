<!-- Snapshot of the living doc "Formwork — Functional Specification": https://claude.ai/code/artifact/659cca3b-399b-425f-bb5f-8b23577d5714
     The living doc is the master; edit it there, not here. This file is re-exported
     whenever the doc is updated (see .claude/skills/update-docs/SKILL.md). -->

# Formwork — Functional Specification

Sep 29, 2026 · @Chris TERRY

## 1. Purpose and scope

This specification describes what Formwork does as built on 4 October 2026 (database migrations up to 364). It is written from the live system and its code, not from a plan, so it is a record of current behaviour, not a wish list.

**Formwork** is the school management information system (MIS) for Adorable British College, a boarding and day secondary school of about 260 students in Years 7–12. It is used by staff, students and parents at misform.work.

**Audience:** the principal, SMT, anyone taking over development, and auditors. Staff, students and parents learning to use Formwork should read the [Formwork User Manual](https://claude.ai/code/artifact/419e765d-009a-414f-9da4-d81b2dd75894) instead: step-by-step guides for each role, with screenshots on invented data.

**How requirements are written.** Each module has numbered requirements (FR-4.3 = module 4, requirement 3). Each is labelled with how it is enforced:

- **\[DB\]** — enforced by the database. It holds however someone reaches the data, including an edited browser request.
- **\[Page\]** — enforced only by the web page. It guides normal use but is not a security boundary.

Where behaviour differs from what a page suggests, it is listed in section 24, Known issues. An issue that is later fixed stays in that section, marked Fixed.

## 2. System overview

Formwork is a web app whose pages talk straight to the database. The trustworthy rules live in the database itself, as security policies, functions and triggers, not in the pages.

&#91;embedded content: Formwork architecture · 3 user groups, 6 components\]

Every screen reads and writes the database directly under the signed-in person's own access; only backups and AI comments go through server routes.

| Part | What it is | What it does |
| --- | --- | --- |
| Web app | Next.js 14, hosted on Vercel at misform.work | Every screen for staff, students and parents. Works on phones. |
| Database | Supabase (Postgres), project "adorable\_mis" | Holds all data. Row-level security decides who sees and changes each row. Functions and triggers carry the business rules. |
| Sign-in | Supabase Auth, plus Google Workspace for staff and students | Email and password for everyone; Google sign-in links only to a login Formwork already made. |
| Email | Google Workspace, sent as mis@abc.sch.ng | One queue for every email, with a Reply-To for each kind. |
| Scheduled jobs | pg\_cron in the database | Email queue every 15 seconds, register alerts every 15 minutes, detention reminders on Thursdays. |
| Server routes | 3 routes in the web app | Nightly backup, and two AI helpers for report comments. Each checks the caller first. |
| AI | Anthropic Claude API | Drafts and checks report comments. Never reads or writes the database. |
| Backups | Nightly dump to private storage, plus Supabase's own daily backups | See section 23. |

**Where the data came from.** Formwork's data came from SIMS. Enough was extracted to run a working system, but it is a subset, not a full copy:

- **Not exported from SIMS:** its history of changes, and records of students changing class or subject choice. Formwork's history of changes starts from the import.
- **Never in SIMS:** medical details. SIMS wasn't designed for them, so the clinic's records start in Formwork.
- **Held elsewhere:** tuckshop records, on a separate system.
- **Fees:** the bursar calculated fees on a spreadsheet and imported them into SIMS to send out. Payments were traced by the bursar and the office, not through SIMS.

**Imports that continue:** Nova-T timetable and meeting files, CoreSats CAT4 and NGRT scores, and gradebook CSVs.

The Other Half, the tuckshop, behaviour, results, reports and fees are run entirely in Formwork.

## 3. Users and roles

Formwork has three kinds of user: staff, students and parents. A member of staff can hold several roles at once, and each role opens pages and permissions.

| Role | Who holds it | Main powers |
| --- | --- | --- |
| admin | 3 accounts (an account setting, not a staff role) | Passes nearly every check. Sets permissions, bell times, imports, backups. Cannot unlock the tuckshop hand-out list or use Hand Out. Has no access to medical records (migration 363). |
| smt | Senior leaders | Calendar and terms, behaviour picture review, Change History, Grade History, email reply routes, publishing fees, sending messages, OH management. |
| hr | HR | Staff HR records, register alerts, staff roles (any except admin). |
| pastoral | Pastoral staff | Appeals, detentions, editing behaviour events, class allocation, sending messages. |
| houseparent | Boarding houseparents | Their house's students by default; appeals, detentions, pastoral comments. |
| head\_of\_boarding | Head of boarding | Houseparent powers across all houses; counts as pastoral. |
| teacher | Teaching staff | Registers, results for their own classes, behaviour logging, subject comments, recording reading tests. |
| mentor | Form tutors | Their mentor group; mentor comments. |
| head\_of\_department | HoDs | Class Progress for their department; deleting their department's scores; class allocation. |
| assessment\_manager | Data lead | Any result, target, CAT4/NGRT; transcript grades; Grade History; publishing documents. |
| assessment\_user | Data assistants | Enter any result or target, but not delete. |
| bursar | Bursar | Fees, invoices, payments, discounts; tuckshop admin (not Hand Out). |
| school\_office | Office / SRO | Student records (all fields), parent records and logins, parent welcome letters, register alerts, releasing −5 behaviour to parents, messages, class allocation, planned absences. |
| attendance\_officer | guardian.counselling@ (Osione ILOEJE), from 1 Oct 2026 (migration 310) | The missed-lesson pop-up and Missed Lessons (FR-4.14–4.20); planned absences (FR-4.21–4.28). |
| admissions | Admissions | Admissions pages and student entry. |
| tuckshop | Tuckshop staff | Tuckshop pages only, including Hand Out. |
| tuckshop\_owner | cs@ (Uju MBA) | As tuckshop, plus the only role that can unlock a saved hand-out list. |
| nurse | School nurses: nurse10@, nurse12@, nurse13@, hoc@ | Clinic and medical records: view, add, edit and delete (FR-11.6). The only role that can delete them. |
| dsl | Designated Safeguarding Lead: cs@ (Uju MBA), from 4 Oct 2026 (migration 363) | Clinic and medical records: view, add and edit, not delete (FR-11.6). The only role that can mark a sick-bay entry as safeguarding and read its hidden details (FR-11.10–11.11). |
| other\_half | OH coordinator | Manages OH activities and choices. Nobody holds it at present. |

Two further roles exist only to approve fee prices (FR-10.10): **principal** (principal@) and **college\_secretary** (cs@). Being an admin doesn't count as either.

**Students** see their own timetable, grades, behaviour (and appeal), tuckshop ordering, OH choices and documents. **Parents** see each linked child's timetable, results (after the delay set on Lookups, FR-7.34), released behaviour, attendance, published fees, tuckshop balance and documents.

**Two layers of access:**

- **Page access** — which tiles and pages a role sees, set by admins at /admin/permissions. \[Page\]
- **Data access** — what a person can actually read or change, set by database policies. \[DB\]

Giving a role a page does not give it the data behind the page.

## 4. FR-1 Sign-in and accounts

Only Formwork creates logins; nobody can create their own account, by email or by Google.

**Creating logins**

- **FR-1.1** A staff login is created automatically when a staff record gets an email, and a student login when a student gets a school email. Each has a random 10-character password. \[DB\]
- **FR-1.2** The welcome email with that password is sent only when an admin saves the record. Admins can send a password-reset link from the "never signed in" lists for staff and students. \[DB\]
- **FR-1.3** Parent welcome letters are sent by year group from /parents/welcome-emails, by admins and the school office (migration 299, the principal's decision, 1 Oct 2026), up to 500 per send, once per parent. Only admins can pause or resume all emails to parents; the office sees whether they are paused, and nothing is sent while they are. The letter sets the first password to the oldest current child's date of birth (DDMMYYYY) and forces a change at first sign-in. A first send skips parents who have already signed in. \[DB\]
- **FR-1.4** A letter can be sent again to any parent with a login, including one who has signed in and chosen a password. It resets the password to the date-of-birth one and forces a change at the next sign-in; a parent with a login who was never sent the letter is then recorded as sent. "Show: Signed in" on the page has tick-boxes and "Send again", and the confirmation says how many signed-in parents will lose their chosen password. Still admin only, up to 500 per send, and blocked while parent emails are paused. If a parent who has never signed in has a new email, the login moves to the new address first; the send stops if another login already uses it. \[DB\]
- **FR-1.5** The school office can create one parent's login from the student page. It gets a random password, emailed (or shown once if parent email is paused), and is not forced to change. \[DB\]
- **FR-1.6** A student whose email changes before their first sign-in has their login moved to the new address. \[DB\]

**Signing in**

- **FR-1.7** Staff and students can sign in with their school Google account, but Google only links to an existing Formwork login. An unknown Google or Gmail account gets no session, and the page says "not set up in Formwork yet". Parents use email and password only. \[DB\]
- **FR-1.8** A flagged account is sent to /change-password before anything else. The new password must be at least 8 characters. \[Page\]
- **FR-1.9** When a student stops being active, their login is blocked at once, for password and Google, and they are signed out. It is unblocked if they become active again. \[DB\]
- **FR-1.14** Forgot password (/login/forgot, linked under every password form) emails a link to choose a new password, which opens /change-password on misform.work. The page says the same thing whether or not the email has an account. It is meant for parents: it tells staff and students they need no password and links them back to their school account, and tells parents to check spam and, if nothing arrives in 15 minutes, to ask the school office to resend their welcome letter. Reset emails come from Supabase Auth's own sender, not the school's mail. As of 4 Oct 2026 no parent has used it; 18 staff and students have. \[Page\]

**Server routes**

- **FR-1.10** Every server route except the parents' calendar feed (FR-1.11) checks the caller's sign-in and page access before doing anything, and the build fails if one doesn't. Backup is admin-only whatever the permissions page says. \[DB + build check\]
- **FR-1.11** One route works without sign-in: the parents' calendar feed (/api/calendar-feed/…), because calendar apps can't sign in. Each parent's secret link is the check instead, and the build check lists this route as its only exception. It returns only the events parents see on their calendar page, and nothing once none of the parent's children is still at the school. Agreed by the principal, 30 Sept 2026 (migration 274). \[DB + build check\]
- **FR-1.12** /admin/permissions shows each role three ways (migration 327, 2 Oct 2026). **Pages**: which pages it opens, ticked by section. **What they can do**: for each kind of record, whether the role can view, add, edit and delete it: Yes (any record), Own only (records tied to the person, such as their classes) or No, with the rule names behind each answer. It is worked out live from the database's own rules for someone holding only that role, so it changes as soon as a page is ticked or a rule changes. Actions done through checked steps (fee approvals, admissions decisions, planned absences) show as View only, and checks made on saving aren't shown. **Compare roles**: every page against every role. Only admins can change page access and the student Core Data field grants; the database rules themselves can't be changed from the app. \[Page; rules read from DB\]
- **FR-1.13** Some abilities are tick boxes on "What they can do" (migration 329, 3 Oct 2026; stage 1 of docs/role-abilities-design.md): certificates and certificate levels, the seven sick-bay tables, the BMI reference table and grade boundaries. They start as each role's access before the change, except grade boundaries. Only admins can tick or untick. Before a change saves, the page names the people who would gain or lose it. Admin can't remove its own access to permissions, and every tick and untick is logged in Change History under access. Stage 2 (migration 330, 3 Oct 2026) added behaviour (events, involved students, photos, appeals, categories, detentions), attendance (registers, codes, planned absences, register alerts) and reports (periods, checkers, subject and pastoral comments), each with the access it had before. Rules tied to particular records stay fixed: a teacher's own report comments, a checker's report period, students' and parents' own records, and whoever can edit an event writes its involved students. Actions the app never allowed (deleting register marks, creating detentions by hand) are padlocked with the reason. Stage 3 (migration 331, 3 Oct 2026) added results, target and transcript grades, CAT4, NGRT, reading tests, subjects, departments, the grade scale, subject aliases and key stages, homework (viewing), which classes use homework, and marking schemes, again with the access each had. Teachers' scores for students they teach, Heads of Department's for their department, who can delete a score, and every rule for setting, marking and attaching homework and students' done ticks stay fixed and padlocked. Stage 4 (migration 332, 3 Oct 2026) added 41 tables: students and families, staff and HR, the tuckshop, The Other Half, student groups and admissions. An action became a tick only where every rule granting it names just roles or pages; where a rule also looks at the record or the person, or lets parents or students in, it stays and is padlocked with the reason (for example, a new applicant always starts as an enquiry, only unpaid enquiries are deleted, group marks belong to the group's own staff, each family sees its own tuckshop orders). Editing a student stays field by field. Stage 5 (migration 333, 3 Oct 2026), the last, added the 12 fee tables: discounts, payment plans, charge batches, and adding invoices, charges, payments and fee items became ticks; who sees invoices, charges, payments, fee items and terms (parents included, once a term is published) and everything about prices stay padlocked, and fee prices still can't be written from the app whatever is ticked. Stage 6 (migration 334, 3 Oct 2026) added the timetable, calendar and next year: classes, class lists, lessons, blocks, periods, bell times, mentor groups, staff commitments, terms, academic years, calendar events and next year's plan; changing them became ticks, while reading the timetable, calendar and term dates stays open to everyone signed in. 110 tables are now tickable. Staff roles, page permissions, logins, the tick tables themselves and system settings are deliberately not tickable, so a tick can never hand out admin powers. Some cells have a padlock and can't be ticked by anyone, admin included; they change only by a database change the principal agrees: only the school office adds students; Grade History and Change History can't be edited, and who reads them is fixed; fee prices and price changes need the principal and the college secretary; certificate levels, the BMI table and grade boundaries are readable by everyone signed in. Parents never seeing homework marks or other students' names in behaviour events is not a staff tick at all. \[DB\]

## 5. FR-2 Students, parents and portals

Every member of staff can read the whole student record; what each role can change is granted field by field.

**Student records**

- **FR-2.1** Each role can be given Edit on any of 38 student fields (names, date of birth, year, form, boarding house, medical notes, status, photo and so on). A change to a field the editor wasn't granted is refused. The school office has all 38. \[DB\]
- **FR-2.2** Only admins and the school office can change fees fields, ethnicity/FSM fields and family links. Only admins can delete a student. \[DB\]
- **FR-2.3** Admission numbers are six digits, issued automatically from the next number in the series, and unique. A number typed in is kept. \[DB\]
- **FR-2.4** Admission date is required; if left blank on a new record it becomes today. \[DB\]
- **FR-2.5** Marking a student as anything other than active removes them from all their classes, whoever makes the change. Attendance, behaviour and results history are kept. \[DB\]
- **FR-2.6** A student's form must be a real mentor group, and their mentor group follows it. \[DB\]
- **FR-2.7** Photos are stored on the student record, shrunk to 400 px in the browser. Admins can bulk-import them. \[Page\]
- **FR-2.8** The Students list loads nothing until asked, since the whole school with photos is slow. Typing a name searches straight away, and after two letters up to eight matching students appear under the search box as blue buttons (name, form, year); choosing one opens that student. The list follows the Status, Year and Form filters and a houseparent's house. \[Page\]
- **FR-2.9** Every student added records who added them and when, taken from the signed-in person whatever the page sends, and it can't be changed afterwards. Students added before 30 September 2026 have no record, except the two added through the app that day (Victory NNAMOKO, from Supabase's request logs). \[DB\]
- **FR-2.10** Names are tidied on every save, for students, applicants, parents and staff: spaces at the start or end are removed and double spaces become single. Tidying a stored name never counts as a name change for someone only allowed to edit other fields. \[DB\]

**Parents**

- **FR-2.8** A student can have several parents and a parent several children. The school office manages parent records and links; link changes are logged in Change History. \[DB\]
- **FR-2.9** Staff can find a parent by name or email when writing a message. Only parents with at least one active child appear. \[DB\]
- **FR-2.10** Admins, SMT and the school office can view any parent's portal as that parent sees it, using only their own access (View as Parent). \[DB\]
- **FR-2.19** Adding a new parent on a student's record checks the email as it is typed. If a parent already has it, the form shows who, their phone and the children they are linked to (leavers marked), with a "Link this parent instead" button. Saving a second parent with the same email needs a deliberate "Add as a separate parent anyway" tick. Added 4 Oct 2026 after a parent signed in to an empty portal (known issue 31). \[Page\]

**Student documents**

- **FR-2.11** Documents (reports, transcripts, score sheets) are stored one per student, per type, per term; a new copy replaces the old. Admins, SMT and assessment managers publish or delete them, and can bulk-upload PDFs matched to students by file name. \[DB\]

**Portals**

| What | Student portal | Parent portal (per child) |
| --- | --- | --- |
| Timetable, with Other Half activity | Yes | Yes |
| Grades against targets | Yes | Yes |
| Mark appeals | Appeal own marks from the last 5 days; 5 credits a year (FR-7.24) | No |
| Behaviour | Own events (not voided); can appeal negatives | Only events released to parents |
| Attendance | No | Yes, including today lesson by lesson |
| CAT4 / NGRT scores | No | Yes |
| Reading ages | No | Yes, once there are two readings: each with the age on the day, the gap and a chart (FR-7.22) |
| Fees | No | Only for terms SMT has published |
| Tuckshop | Order, see balance and purchases | See balance and purchases; cannot order |
| Other Half | Choose activities during Evening Prep | See the chosen activity |
| Published documents | Own | Each child's |
| Homework (Years 7–12) | Own classes' homework, files and links; own grade once released; this school year | No |
| Student groups | Own groups marked for students or for students and parents (FR-18.17) | Only groups marked for parents (FR-18.17) |
| Inbox | Yes | Yes |

- **FR-2.12** Each portal shows only the signed-in student's own data, or the parent's linked children's. \[DB\]

* **FR-2.13** A parent sees a child only while that child is an active student. When a child leaves, their records drop out of the parent portal, though the parent link is kept. Staff who are also parents still see leavers through their staff access. \[DB\]

**Families and siblings**

- **FR-2.14** A parent's relationship (Mother, Father, Other and so on) is recorded for each child they are linked to, not once per parent. The parent's own value is used only where a link has none. \[DB\]
- **FR-2.15** A student's profile has a Siblings card, for staff only, listing brothers and sisters found through shared parents: current students first, then leavers with their leaving date. Only name, year and form are shown, never parent details. \[DB\]
- **FR-2.16** Two children are siblings through a parent only when neither child's link to that parent is "Other". The principal's and college secretary's links to students they follow through the parent portal are "Other" (cs@ is Mother only for her own children), so they never make unrelated children siblings. \[DB\]

**Gender**

- **FR-2.17** Every student's gender is required and is Male or Female, chosen from a list on the New Student page and the student record. It can't be blanked by an edit or a CSV re-import; the import converts Male/Female and refuses a new student without one. \[DB\]
- **FR-2.18** Only the school office can add a new student, at /students/new or /students/import; holding admin is not enough. Admins can still see, correct and delete student records. Someone who holds both admin and school\_office adds students through their office role, so to stop a person adding students, remove their school\_office role (migration 275). Until migration 328 any admin login could still add a student, because the rule's role check lets every admin through (known issue 32). \[DB\]

## 6. FR-3 Timetable, classes and Nova-T imports

The timetable comes from Nova-T and is imported by admins; Formwork never invents classes or subjects.

**Structure**

- **FR-3.1** The school day has 9 sessions: Registration (M), Lessons 1–6, The Other Half (OH) and Evening Prep (EP). Each weekday has its own bell times, set by admins at /admin/bell-times. Sunday has an Evening Prep bell time only (migration 362, 4 Oct 2026), because prep runs Sunday to Friday; Sunday has no lessons, and Bell Times lists it but leaves it out of "make these days the same". \[DB\]
- **FR-3.2** Saving a bell time moves every lesson in that period to the new time. A session can't be removed from a day while lessons are timetabled in it. Registers are tied to the period, not the time. \[DB\]
- **FR-3.3** A class belongs to a curriculum block. In an ordinary block a student can be in only one class; compound blocks (Pathway, Vocational) allocate a whole group of subjects together. \[DB\]
- **FR-3.4** A single lesson can have its own teacher or room, different from its class. Timetables, printed timetables, Registers Not Done and alerts all use the lesson's own first. \[DB\]
- **FR-3.5** Staff commitments (meetings, part-time non-working periods) block only that person's own slot and have no register. \[DB\]

**Who changes what**

- **FR-3.6** Only admins change classes, lessons, staff commitments and bell times. Admins, Heads of Department, pastoral staff and the school office move students between classes, at /admin/block-allocation, and edit next year's planned enrolments. The school office was added on 2 Oct 2026 (migration 317): it had the page, but every save was refused. \[DB\]

**Nova-T timetable import (/admin/import-classes, admin only)**

- **FR-3.7** A lesson's subject comes only from the subject code in the group name, with the set number removed (10LI/El → El = Literature). Subject codes are maintained in SQL, never guessed. The "Electronics" subject, which the original import invented by guessing a code, was removed on 1 Oct 2026 along with its grade boundaries; nothing else used it (migration 314). \[Page\]
- **FR-3.8** Groups coded Oh (Other Half) or Sa (Sports Academy) are skipped. \[Page\]
- **FR-3.9** The file is treated as the complete list of each class's lessons: missing lessons are removed and new ones take the bell time. A class with nothing readable in the file is never emptied. \[Page\]
- **FR-3.10** Every change is previewed before it is applied. Classes missing from the file are offered for deletion: empty ones pre-ticked, ones with students left for a person to decide. \[Page\]
- **FR-3.11** A class renamed in Nova-T is recognised from who is enrolled and treated as a rename. \[Page\]

**Student class import (/admin/import-timetable, admin only)**

- **FR-3.12** Adds enrolments, and swaps a student within a block for a set change. By default it also removes enrolments the export no longer lists, only for students in the file. \[Page\]

**Timetable views**

- **FR-3.13** Staff see their own week, with lessons, OH activities and commitments; clicking a lesson opens its register. Students and parents see the student's week with their OH choice. \[Page\]
- **FR-3.14** Printed timetables: every active student in a year, 8 to an A4 page. Class lists print by year, subject or class. \[Page\]

## 7. FR-4 Registers and attendance

Registers are taken lesson by lesson, and any lesson whose register isn't taken 15 minutes after it starts is flagged.

**Taking registers (/attendance)**

- **FR-4.1** Any member of staff can mark any register, for any class or activity. This is the school's decision (27 Sept 2026); since migration 330 it is a tick on /admin/permissions, set for every role. \[DB\]
- **FR-4.2** One mark per student, per date, per period: present, late, absent or authorised absence. Saving again overwrites. \[DB\]
- **FR-4.3** No register can be saved for a future date (Lagos time). Past dates are allowed after a confirmation. \[DB / Page\]
- **FR-4.4** A late mark needs the minutes late (0–600). While the lesson is running, the box suggests the minutes since it started. \[DB range; Page requires it\]
- **FR-4.5** Beside each student, the register shows their other marks today as coloured badges (M, L1–L6, OH, EP), and for subject classes their last grade. The last grades are hidden until the teacher presses "Show last grades", so they are not on the class's screen by default. \[Page\]
- **FR-4.6** Changes and deletions of marks are logged permanently in Change History; taking a register is not. \[DB\]
- **FR-4.7** Parents can read their own children's attendance; students cannot read attendance. \[DB\]

**Registers Not Done (/pastoral/registers-not-done)**

- **FR-4.8** A lesson is listed when it is timetabled today inside term dates, more than 15 minutes past its start, has at least one enrolled student, and none of them has a mark for that period, not counting marks filled in by a planned absence (FR-4.26). It stays listed for the rest of the day. \[DB\]
- **FR-4.9** The row goes to the lesson's own teacher where Nova-T gives it one, otherwise to the class teacher. OH activities are listed the same way (FR-5.12). \[DB\]
- **FR-4.10** Open to pastoral, houseparent, SMT and admin. Each teacher also sees a banner of their own overdue registers on their timetable. \[Page\]

**Register alerts (/admin/register-alerts)**

- **FR-4.11** Every 15 minutes, outstanding registers are copied into a permanent alert list, once per lesson per day (once per activity per staff member for OH). An alert stays even if the register is taken later, until someone marks it resolved. \[DB\]
- **FR-4.12** HR, the school office and admins see and resolve alerts. Nobody can create or delete them from the app. \[DB\]

**Attendance summary**

- **FR-4.13** For each student: today, this week and this academic year — sessions, present, late, authorised absent, absent, and total minutes late. The year starts at the first term beginning on or after 1 August. \[DB\]

**Missed Lessons (/pastoral/missed-lessons, migrations 307–308)**

- **FR-4.14** For a chosen day (today by default), lists every active student who was marked present or late at least once that day and marked absent without a reason (unauthorised: codes N and O) at one or more other periods, before or after. Authorised absences never count. \[DB\]
- **FR-4.15** Each row shows the day's marks as badges (M, L1–L6, OH, EP) and, for each missed period, the lesson the student should have been in (the lesson's own teacher first), the code and who marked it. For an earlier day the lesson is read from today's classes and timetable (Known issue 28). Today's list refreshes every minute. \[Page\]
- **FR-4.16** Open to SMT, pastoral, school office, attendance officer and admin; the database refuses anyone else. A tile on the staff dashboard's second row shows today's count (FR-13.5). \[DB\]

**Missed-lesson pop-up (migration 309)**

- **FR-4.17** A full-screen, flashing pop-up appears on whatever Formwork page is open when, today, a period started at least 15 minutes ago and a student who was marked present or late at an earlier period is marked absent without a reason in that period's register. It covers registration, lessons, the Other Half and Evening Prep. \[DB rule; Page display\]
- **FR-4.18** Each alert shows the student, their year, mentor group and house, the lesson, teacher and room they should be in, where they were last seen, and who marked them absent. \[Page\]
- **FR-4.19** "Seen: dealing with it", with an optional note, clears the alert from every screen and records who saw it and when; only a live alert can be marked seen. A corrected mark (present, late or an authorised absence) clears the alert by itself. "Hide for 2 minutes" hides the current alerts on that screen only; a new alert still shows at once. \[DB; hiding is Page\]
- **FR-4.20** It goes to anyone whose role is granted "Missed-lesson pop-ups" at /admin/permissions: school\_office and attendance\_officer to start with. Being admin is not enough. The page checks every minute, flashes the browser tab's title, and beeps on a new alert once someone has clicked on the page. \[DB\]

**Planned absences** (/attendance/planned-absences, Pastoral card, migration 318, 2 Oct 2026)

- **FR-4.21** School office, attendance officer, pastoral, SMT and admin can give a student one attendance code for a run of whole days, with an optional note. All staff can see the list. \[DB\]
- **FR-4.22** Only authorised codes can be planned: other authorised absence, educational visit, authorised holiday, illness, medical/dental appointment, and X, Excluded from school. X was added by migration 318 and counts as an authorised absence, so it never shows in Missed Lessons or the pop-up. \[DB\]
- **FR-4.23** Every period the student has on each day is filled in: their timetabled lessons (registration and Evening Prep included) and their Other Half activity. A class joined later counts only from the day they joined. Days outside term dates and days with a holiday on the calendar are skipped. \[DB\]
- **FR-4.24** Past days and today are filled in as soon as the absence is saved; later days at 05:30 each morning, so FR-4.3 still holds. A mark already in a register is never overwritten (the principal's decision). \[DB\]
- **FR-4.25** A student can't have two planned absences over the same days. \[DB\]
- **FR-4.26** The register shows the code already filled in, tagged "planned". Once a teacher saves that register the mark is theirs, whether or not they change the code. A planned-absence mark doesn't count as the register being taken (FR-4.8). \[DB; the tag is Page\]
- **FR-4.27** End early (the day the student is back) removes the marks it filled in from that day on; Cancel removes all of them. Marks a teacher has saved stay. \[DB\]
- **FR-4.28** The note is staff-only; parents see only the code on their child's attendance. Planned absences, and marks removed by ending or cancelling one, are logged in Change History under Registers. \[DB\]

## 8. FR-5 The Other Half

The Other Half (OH) is the after-lessons activity programme, run entirely in Formwork; students choose one activity per weekday, only during Evening Prep.

**Programme**

- **FR-5.1** OH is never taken from Nova-T: its activities, staff, rooms, year groups and choices live only in Formwork, and the Nova-T import skips Oh and Sa groups. Sports Academy is an OH activity. \[DB / Page\]
- **FR-5.2** SMT, the other\_half coordinator and admins create, edit, retire and delete activities, and open or close choices for a term with an optional closing time. \[DB\]
- **FR-5.3** Each activity runs on one weekday in one term and repeats weekly. It needs a name and at least one year group; capacity is 1 or more, or blank for no limit. Several staff can share one. \[DB\]
- **FR-5.4** A retired activity can't be chosen and drops off staff timetables and Registers Not Done. An activity can't be deleted while any student has it chosen. \[DB\]
- **FR-5.5** A new term can be started as a copy of another term's programme (activities and staff, not choices), offered only when the term is empty. \[Page\]
- **FR-5.6** Only admins can delete a term, because that also deletes its OH programme and choices. \[DB\]

**Student choice (/portal/other-half)**

- **FR-5.7** A student can choose, change or clear a choice only when all of these hold: it is Evening Prep now (the EP bell time for today, currently 19:00–21:00 Sun–Fri; Sunday was added by migration 362 after a Year 11 student couldn't change a choice on a Sunday evening); choices are open for the term and the closing time hasn't passed; the activity is active; the student is active and in one of its year groups; and the activity isn't full. \[DB\]
- **FR-5.8** One choice per student per weekday per term; choosing again replaces it. Two students can't both take the last place. \[DB\]
- **FR-5.9** Staff with OH management can place, move or remove any student's choice at any time at /other-half/choices, and can go over capacity or outside the year groups after an "anyway?" warning. \[DB / Page warning\]

**Placed and locked by the school (migration 302)**

- **FR-5.14** From a student group's page, SMT, pastoral staff, the school office, the Other Half coordinator and admins can put every current student in the group into one activity. It replaces each student's choice for that day only. A full activity, one outside a student's year group, or replacing existing choices gets an "anyway?" warning, then goes ahead. A group's kind "Other Half" (formerly Activity) means it is for the Other Half: when a group built from a rule is saved with that kind, the activity and the lock can be chosen on the same form, and saving places the group in one step. \[DB / Page warning\]
- **FR-5.15** The placement can be locked until staff unlock it, locked until a date (that day included), or not locked. While a lock is in force the student can't change or clear that day, even during Evening Prep with choices open. Who locked it and when are recorded by the database. \[DB\]
- **FR-5.16** When a lock ends (its date passes or staff unlock one student or the whole group), the student stays in the activity and may change it at Evening Prep while choices are open. \[DB\]
- **FR-5.17** Students and parents see "Placed by the school" and the end date, if any, never why. The group's page shows each student's activity per day and its lock. \[Page\]

**Registers and absentees**

- **FR-5.10** Any member of staff can take an OH register. It lists the students who chose the activity, and marks go into normal attendance at the OH period, tagged with the activity. A student already marked in another activity that day can't be marked again. \[DB / Page\]
- **FR-5.11** /other-half/absentees shows, for one day: students marked absent in OH (with whether they were in school earlier — "find these first"), students not yet marked, and students with no activity chosen. For SMT, the coordinator and admins. \[Page\]
- **FR-5.12** An OH activity appears in Registers Not Done 15 minutes after that day's OH start, if at least one student chose it and nobody has been marked. Each member of staff on it gets their own register alert. \[DB\]

**Timetables**

- **FR-5.13** Students, parents and the student record show the chosen activity, room and staff in the OH slot for the current term. Staff see the activities they run. \[Page\]

## 9. FR-6 Behaviour, appeals and detentions

Staff log behaviour by category, points come only from the category, and a −5 event or a week at −10 books a Friday detention automatically.

**Logging**

- **FR-6.1** Any member of staff can log a positive or negative event for one or several students; students and parents can't. \[DB\]
- **FR-6.2** Every event needs a category, and its points come from the category (−1 to −5, +1 to +5). Staff can't type points. Only admins set categories and points, at /admin/lookups. \[DB\]
- **FR-6.3** "Logged by" is always the signed-in person. The event's class is worked out from the class the teacher shares with the student. \[DB\]
- **FR-6.4** A −5 (serious) event can't be saved without a written explanation. \[DB\]
- **FR-6.5** One picture can be attached per logging, on positive events only, shrunk in the browser and under about 150 KB. The page shows the picture field only for positive events, and the database refuses a picture on a negative event (migration 297, the principal's decision, 30 Sept 2026). The six negative events that already had a picture were all declined, so no parent saw them; they are kept. \[DB\]

* **FR-6.5a** Staff can choose students for a group logging by class, house, room, restaurant or year. /behaviour/log searches and filters past events; /behaviour/alerts lists events of −3 or worse in the last 7 days (a houseparent sees their own house). \[Page\]
* **FR-6.5b** Every list of events shows who logged each one: /behaviour/log, alerts, review, detentions, appeals and the Behaviour tab of a student's profile. \[Page\]

**Editing and deleting**

- **FR-6.6** The teacher who logged it, pastoral, houseparent, head of boarding, SMT, school office and admin can change an event's comment and category (negative stays negative). Detentions are recalculated. Events withdrawn on appeal can't be edited. \[DB\]
- **FR-6.7** Only SMT can delete an event, a merit included; holding the smt role is what counts, and admin alone is not enough (migration 319, the principal, 2 Oct 2026; live only from 3 Oct 2026, through migration 330, see known issue 33). Staff can't withdraw an event or move it to another student any other way; only an upheld appeal withdraws one. Changes and deletions are logged in Change History. \[DB\]

**Release to parents (/behaviour/review)**

- **FR-6.8** Positive events are always visible to parents. Negative events are hidden until reviewed. \[DB\]
- **FR-6.9** Events with a picture: SMT or admin send the text with the picture, the text alone, or decline. −5 events without a picture: the school office, SMT or admin release the text (SMT since migration 336; in practice the principal's PA and SMT, the only reviewers the principal wants). −1 to −4 events without a picture never go to parents. SMT get an inbox notice for each picture to check. \[DB\]

**Alerts**

- **FR-6.10** When a negative event is logged and it is −5, or the student's negative total for the Saturday–Friday week reaches −8, an alert email goes to cs@, copied to every SMT member and sro@. Replies go to guardian.counselling@. \[DB\]

**Appeals**

- **FR-6.11** A student can appeal their own negative event, once per event; the appeal always starts as pending. Parents can't appeal. \[DB\]
- **FR-6.12** Pastoral, houseparent, head of boarding, SMT and admin decide appeals; any staff can read decided ones. \[DB\]
- **FR-6.13** An upheld appeal voids the event (points to 0, original kept), hides it from the portals, cancels its detention and, if the week no longer reaches −10, the weekly detention, and tells the student. \[DB\]

**Detentions (/detention)**

- **FR-6.14** A detention is booked automatically for the Friday of the Saturday–Friday week when a −5 event is logged, or when the week's negative total reaches −10 (positive points don't offset). Staff can't add or delete detentions by hand. \[DB\]
- **FR-6.15** Detentions are in CG4 after lesson 7. Statuses are scheduled, attended, missed and cancelled. Whoever has the /detention page marks them attended or missed, but only SMT can cancel one (migration 319, the principal, 2 Oct 2026; live from 3 Oct 2026, migration 330); the Cancelled option is shown only to SMT. A detention's date and student can't be changed. Detentions still cancel automatically when an event's category is corrected below the thresholds or an appeal is upheld. \[DB\]
- **FR-6.16** The student (not parents) gets an email and inbox notice when a detention is booked, a reminder at 7:30pm on Thursday, and a notice if it is cancelled. Replies go to SMT. \[DB\]

**Certificates**

- **FR-6.17** Behaviour-points certificates are awarded at points milestones and printed from /certificates; each student gets each milestone once. \[DB\] (See Known issues.)

**Rules set on Lookups**

The behaviour numbers above are the current settings, not fixed values: anyone with the Lookups page (admin, SMT and HR at present) can change them.

| Setting | Current value | What it does |
| --- | --- | --- |
| Single-event detention | −5 | An event this bad or worse books a Friday detention and sends the alert email |
| Weekly detention total | −10 | A Saturday–Friday negative total this bad books one weekly detention |
| Weekly alert total | −8 | A weekly negative total this bad sends the behaviour alert |
| Serious event | −5 | Needs a written explanation and review before parents see it |
| Detention room and time | CG4, after lesson 7 | Shown in detention notices |
| Certificate levels | Bronze 100, Silver 200, Gold 500 | Points needed for each certificate |

- **FR-6.18** Thresholds must be negative whole numbers. Changes apply to new events only; detentions already booked stay as they are. Every change is logged in Change History (behaviour). \[DB\]
- **FR-6.19** Certificate levels each have a unique name and a unique points value above 0; they can be added, changed or removed. An award records the level's name, so a certificate already given stays given if the points change. \[DB\]
- **FR-6.20** The serious-event explanation is checked by the database when an event is edited or reviewed, but only by the page when it is first logged. \[DB / Page\]

**Other students in a serious event** (migrations 303–305, the principal, 1 Oct 2026)

- **FR-6.21** On a serious event (−5 or worse: Stage 5, Bullying, Academic dishonesty), staff can add other students as a witness, involved or target. They find each one with a filter by name, year group and house, when logging at /behaviour (under the explanation, behind a "+ Add a witness, someone involved or a target" button, so the event is written first) or later from the event. Whoever can edit the event (FR-6.6) can add, change or remove them; all staff can see them. The event's own student can't be added, nor anything added to an event withdrawn on appeal. Being added gives a student no points, detention or alert. Changes are logged in Change History (behaviour). \[DB\]
- **FR-6.22** Students and parents never see these links, on any portal. Once parents can see an event, its explanation can't name any of the other students (first, last, preferred or legal names, as whole words; a name the event's own student shares, such as a sibling's surname, doesn't count). Releasing the event, editing its text, or adding a student its text already names is refused, with the word to reword. \[DB\]
- **FR-6.23** A negative event reaches parents only through the review (FR-6.9). Staff can't make an event visible to parents, mark it reviewed or change its type directly, and a new negative event always starts hidden. \[DB\]

**Choosing Stage 5** (migration 335, the principal, 3 Oct 2026, because some staff were logging Stage 5 for minor offences)

- **FR-6.24** When a serious category (−5 or worse) is picked on Log behaviour, a box asks "Is this really a Stage 5?" and shows the school's guidance on what is and isn't one. The guidance is one text, edited at /admin/lookups (Detentions and serious events → Stage 5 guidance) by anyone with that page. Its list covers violence of any kind, bullying, theft, cheating, leaving bounds, abuse of staff, deliberate damage, a phone outside Sunday after lunch and serious laptop misuse. It excludes lateness, uniform, low-level disruption and repeated minor behaviour, which reaches a detention through the weekly total. \[DB / Page\]
- **FR-6.25** A serious event can't be saved until the member of staff ticks "I confirm this is a single serious incident … not low-level or repeated minor behaviour". The same box and tick appear when an existing event is edited up to Stage 5. The tick is a prompt on the page only and is not stored. \[Page\]
- **FR-6.26** Each behaviour category can have a short description, edited at /admin/lookups and shown when the category is picked (when logging, and when changing an event's category). Stage 5, Bullying and Academic dishonesty were given one; the rest are for the school to write. \[DB / Page\]
- **FR-6.27** At Behaviour Review, the reviewer (the school office or SMT; only SMT or admin for an event with a picture) can mark a serious event "Not Stage 5: return to teacher", with a note saying why. Only before parents can see it, and not on a withdrawn event. The teacher who logged it gets the note in their Formwork inbox, and it shows on the event wherever they see it. The event waits under "Returned to the teacher", where it can't be sent to parents. From the moment it is returned it counts 0 points (its category is kept), and its detention is cancelled if it hasn't happened yet, with the week's total detention if the week no longer reaches it; the student is told (migration 337). Detentions already attended stay. If the teacher changes the category, the new category's points count, it leaves the review and detentions are recalculated (FR-6.6). If they keep Stage 5 and edit the explanation, the −5 and its detention come back and it goes to "Waiting for review" again. Staff can't mark or clear a return any other way; any real edit clears it. Returns are logged in Change History (behaviour). Only the principal's PA (through school\_office) and SMT review Stage 5 (the principal, 3 Oct 2026). \[DB\]
- **FR-6.28** Every return is kept permanently against the teacher who logged the event (behaviour\_event\_returns: the teacher, the reviewer, the note and the original category and points), even after the event is changed or deleted. Only SMT and admins can read it. Behaviour Review shows them "Stage 5s returned, by teacher": the number for each teacher and the latest date, to see who needs more training (migration 337, the principal, 3 Oct 2026). Only the return step writes to it. The first four returns (3 Oct 2026, made before the points rule existed) were brought into line: points 0, recorded in the tally, and the one detention not yet held (dated 2 Oct, still "scheduled") cancelled; the other three had been attended and stay. \[DB\]
- **FR-6.29** Behaviour Totals (/pastoral/behaviour-totals, on the Pastoral card, migration 361, the principal, 4 Oct 2026) gives running totals of positive and negative points for a term (the current one to start with), the academic year or chosen dates. Net is positives minus negatives; withdrawn events don't count, and a returned Stage 5 counts its 0 points. Mentors see their own mentor group (the Mentor class on the timetable), student by student, with the number of events, the group's totals and its average. SMT, pastoral, head of boarding and admins also see every mentor group with its mentor, students, positives, negatives, net and average per student (net points divided by all the group's active students, including those with no events), filtered by year with a whole-school or year total, and can open any group. Each student's name opens their profile straight on its Behaviour log. Both tables download as CSV. The page is granted to mentor, pastoral, head\_of\_boarding and smt. The totals come from behaviour\_totals(), which runs under the caller's own permissions; every member of staff can already read behaviour events, so showing a mentor only their group is a display choice. \[Page\]

## 10. FR-7 Assessment, results and targets

Teachers enter percentage scores for their own classes against result sets; each score is graded from the subject's boundaries and compared with the student's target.

**Result sets**

- **FR-7.1** A result set is a calendar event with the "result set" box ticked; SMT and admins manage the calendar. Only the current school year's sets can be picked for entry. \[DB / Page\]
- **FR-7.2** End-of-term exams are one result set per year group per term, back to 2017; Year 12 has Terms 1 and 2 only (Term 3 is WAEC). They are found by year group and term, never by name. \[DB\]
- **FR-7.31** A result set can be special for particular year groups, e.g. Year 12 mocks (migrations 358–359, the principal, 4 October 2026). It is made by choosing the One Year category on the calendar and ticking the year groups; One Year events are always result sets. The database keeps the category and the year groups together, and a special set can never also be an end-of-term exam set. \[DB\]
- **FR-7.32** Only students currently in a special set's year groups can be given a mark in it. Enter Results lists only their classes and students, and the database refuses anyone else. A mark can still be corrected after the student moves up a year. \[DB / Page\]
- **FR-7.33** A special set's marks are kept under its name, not in a week: they don't count as that week's assessment, and the student profile never files an untagged weekly mark on the same day under the special set. \[DB / Page\]

**Entering and deleting scores (/results/enter)**

- **FR-7.3** A teacher enters or changes scores only for students in their own classes, in that class's subject. A Head of Department can also enter and change scores in their department's subjects, the same department rule as deleting them in FR-7.6 (migration 321, 2 Oct 2026); a subject with no department stays with its class teacher. Assessment managers, assessment users and admins can enter any score. \[DB\]
- **FR-7.4** Scores are percentages (0–100). The grade is worked out from the subject's boundaries for that year group when the score is typed, and saved with it; later boundary changes don't regrade saved scores. \[Page\]
- **FR-7.5** One score per student, per subject, per result set. Types: short test, teacher assessment, exam grade (plus imported term exams). \[DB\]
- **FR-7.6** The class teacher, a Head of Department for their department's subjects, and assessment managers and admins can delete a score. Assessment users can't. Scores are deleted on Enter Results, or by assessment managers and admins with the Delete button beside each score on a student's profile (Results tab), with a confirmation. \[DB / Page\]
- **FR-7.7** Every insert, change and delete of a score, target or transcript grade is logged permanently in Grade History, with old and new grade and who did it. Nobody can edit the log. SMT, assessment managers and admins read it at /assessments/grade-history. \[DB\]

**Boundaries, subjects and targets**

- **FR-7.8** Grade boundaries are set per subject and per year group (7–12). Only assessment managers can edit boundaries (the principal, 3 Oct 2026, migration 329; until then any member of staff could), as a tick admins can change (FR-1.13); everyone signed in can read them. Any member of staff can edit subject aliases and key-stage tags (school decision, 27 Sept 2026; since migration 331 an ordinary tick, set for every role). Years 10 and 11 follow Cambridge IGCSE's June 2026 grade thresholds (migration 322, the principal, 2 Oct 2026) in 17 subjects, among them Maths, English, the sciences, Computing, Economics, the languages, Art, PE, Geography and History: time-zone variant 3, the Extended route, each threshold turned into a percentage of the route's total and rounded up. Below the lowest grade is U; Extended Maths and Further Maths stop at E. Years 7–9 keep 90/80/70…, Year 12 (WAEC) is unchanged, and saved results keep their grade. \[DB\]
- **FR-7.9** One target grade per student per subject, on the IGCSE (A\*–U) or WAEC scale. Assessment managers and admins set and delete targets; assessment users set but can't delete. \[DB\]
- **FR-7.10** A subject with no target of its own borrows one from a related subject (e.g. Further Maths from Maths). Portals show targets only for subjects the student takes. /target-grades/coverage lists students missing a target. \[DB / Page\]
- **FR-7.11** Grades are compared with targets as above, on or below (green, amber, red). No comparison is made across IGCSE and WAEC. \[Page\]
- **FR-7.12** CAT4 and NGRT scores are imported from CoreSats by UPN; only assessment managers and admins can change them. Staff and parents can read them; students can't. \[DB\]

**Analysis pages**

- **FR-7.13** Missing Grades lists, class by class, who has no mark in a set. A subject is expected only if someone in that year group has a mark for it. \[DB\]
- **FR-7.14** Top 10 ranks students in a result set by average percentage, per year or overall, sharing tied ranks. \[Page\]
- **FR-7.15** Review Results (subject overview) charts a student's or class's scores across result sets. Class Progress shows each class's average grade against its students' average target. Who sees which classes: SMT, admins, assessment, pastoral and boarding staff see every class; a Head of Department sees their department's (an SMT member who is also a Head of Department sees every class, migration 312); a teacher sees only the classes they teach, as class teacher or for any single lesson. This narrows the page only; results stay readable to staff elsewhere. The database picks one grade per current student and subject for the chosen result set, or the most recent, so the page loads about 4,300 grades rather than every result ever recorded (until migration 313 it downloaded all 59,000 and could stay on Loading on a tablet). \[Page\]

**Reading ages** (/reading-ages and /reading-ages/record, Assessment card, migrations 323–324, 2 Oct 2026; literacy is a school improvement target)

- **FR-7.16** A reading age is kept in years and months with the date it was tested. The gap is the reading age minus the student's age on that day, from their date of birth; a minus means reading below their age. The age and gap are worked out each time they are read, never stored, so correcting a date of birth corrects every gap. \[DB\]
- **FR-7.17** A student's readings come from three places, shown together: the paper test at the admissions interview (once the applicant is enrolled; only the reading, its date and the test name pass across, the rest of the interview stays with admissions), the school's own tests, and NGRT imports (59 students, today's Years 11 and 12, tested 2021–2023). \[DB\]
- **FR-7.18** Recording a test (/reading-ages/record): a test name and the usual date for a year group, form or named student, then a reading age per student; blanks are skipped. A student who sat it on another day gets their own date on their row. One reading per student, date and test; saving again updates it. A test can't be dated after today. Teachers, Heads of Department, assessment managers, SMT and admins can record, correct and remove school tests. Interview and NGRT readings are corrected where they were entered. \[DB / Page\]
- **FR-7.19** The tracker (/reading-ages) is open to teachers, Heads of Department, mentors, pastoral staff, assessment managers, SMT and admins. For the whole school, a year group or a form it shows how many have a reading, the average latest gap, the share reading below their age, how many are in each band (2+ years below, 1–2 years below, up to a year below, at or above; the principal agreed these on 2 Oct 2026), and how many have closed the gap since their first reading. \[Page\]
- **FR-7.20** Change over time: the average gap at each sitting, as a chart and a table, where a sitting is a term (or the school year, for readings before terms were recorded). Each student counts once per sitting, and the table shows how many were tested each time. \[Page\]
- **FR-7.21** The student list puts those furthest behind first and shows the first and latest reading with the change since the first and since the last. A row opens a chart of reading age against actual age over time, and the list downloads as CSV. The same chart and history are on the student's profile (Reading Age tile). \[Page\]
- **FR-7.22** Parents see their own children's readings, for children still at the school, on the parent portal's Reading Age tile, which appears only once the child has two readings from the school's tests or the admissions interview (migrations 325–326: one reading isn't yet a trend, and old NGRT sittings don't count towards the two, though they are shown once the tile appears; before that the database returns parents nothing): the same dates, reading ages, ages, gaps and chart as staff (the principal, 2 Oct 2026). Students see none. Parents read them only through the database's reading-age function, never the table itself. \[DB\]
- **FR-7.23** Every school test added, changed or removed is logged in Change History under Reading ages, with who did it. \[DB\]

**Mark appeals** (/grade-appeals, migrations 354–357, the principal, 4 Oct 2026, because wrong numbers were being entered)

- **FR-7.24** A student can appeal one of their own marks, in any result set, within 5 days of the mark appearing or last changing. A re-import that changes nothing doesn't restart the 5 days. They give a reason and, if they like, the mark on their paper, on the Assessment page of their portal. Parents can't appeal. \[DB\]
- **FR-7.25** Each student has 5 appeal credits a school year. Only an appeal that is turned down uses one; an upheld or withdrawn appeal gives it back. An appeal waiting for a decision holds a credit, so a student can't have more appeals open than credits left. \[DB\]
- **FR-7.26** One appeal per mark at a time; once decided, a mark can be appealed again only if it changes. A student can withdraw a waiting appeal. A student whose subject has no teacher in Formwork can't appeal and is told to see their mentor. \[DB\]
- **FR-7.27** Only the student's teacher for that subject decides, at Mark Appeals (/grade-appeals, on the Assessment card; granted to teacher, head\_of\_department, assessment\_manager and smt). Upheld: the teacher enters the correct score, the grade is worked out from the subject's boundaries for the student's year group, and the change is in Grade History under the teacher's name. Turned down: the teacher must write a note, which the student sees. \[DB\]
- **FR-7.28** The student sees their own appeals, the teacher their students', a Head of Department their department's, and SMT, assessment managers and admins every appeal. Only the teacher decides. Appeals are never deleted. \[DB\]
- **FR-7.29** A new appeal goes to the teacher's inbox and by email, with the subject's Head of Department in cc (replies go to the Mark appeal row at Email Replies, sro@ to start). The Head of Department also gets an inbox copy naming the teacher it went to. The decision goes to the student's inbox and the Head of Department's, unless they decided it themselves; decisions aren't emailed. A student's text appears in the email as plain text, never as links or formatting. \[DB\]
- **FR-7.30** The 5 days and 5 credits are set per school year on Lookups (Mark appeals), by anyone with that page. Changing them doesn't affect appeals already made. \[DB\]

**When parents see marks** (Lookups, migration 360, the principal, 4 Oct 2026)

- **FR-7.34** Parents see a mark only once it is a set number of hours old, counted from when it was first entered, so a wrong number can be put right (or appealed by the student, FR-7.24) before families see it. It covers every mark parents see: ReLPs, Teacher Assessments and all other results. The hours (0 to 168) are set on Lookups (When parents see marks) by anyone with that page; 0 means at once, which is where it started. A correction doesn't restart the clock, and the time a mark was entered can't be changed from the app. Students and staff see marks at once; staff viewing the parent portal, including staff who are parents, see every mark straight away. \[DB\]

## 11. FR-8 Reports, transcripts and documents

Written reports are built only from checked comments; transcripts and score sheets are generated as PDFs and published to the student and parent portals.

**Report periods and comments**

- **FR-8.1** Admins, SMT and assessment managers create report periods, each with year groups, "comments due" and "checking due" dates and an optional "joined from" date for new-student checks. \[DB\]
- **FR-8.2** A teacher writes one comment per student, per subject, per period, with Effort, Presentation and Homework judgements (Excellent, Good, Satisfactory, Needs Improvement). While writing they see the last 5 weeks of grades and the year's trend, and the term's homework marks, which suggest the Homework judgement (FR-17.12). \[DB / Page\]
- **FR-8.3** Mentors, houseparents and SMT each write one pastoral comment per student per period, seeing the subject judgements and best and weakest subjects. \[DB\]
- **FR-8.4** Comments move draft → submitted → checked. The author can edit only a draft. Checkers assigned to the period, SMT and admin can edit, approve, or send back with a note. \[DB\]
- **FR-8.5** "Draft a comment" asks the AI for a 2–3 sentence subject comment or 3–4 sentence pastoral comment, using only the facts on the page. "Check comments" flags spelling, tone and contradictions with the student's data, up to 60 at a time. Only people with the relevant page can use them. \[DB + server check\]

**Generated documents (/reports/generate, admin)**

- **FR-8.6** The written report prints only checked comments, English then Maths then the rest A–Z; a student with none is skipped. \[Page\]
- **FR-8.7** The Termly Grade Report and Term Test Scores sheet show a subject only if it is on the grade report and tagged for the student's key stage; unassessed subjects show grey. \[DB / Page\]
- **FR-8.8** Transcripts: KS3 (Years 7–9, IGCSE) and KS4/5 (Years 10–12, IGCSE and WAEC versions; Year 12 always WAEC). Each square takes the exam mark's grade, then the legacy transcript grade, then the score converted through boundaries (Year 12's for WAEC). Any error stops the PDF. \[Page\]
- **FR-8.9** Publishing replaces the previous copy and makes it downloadable by the student and parents. Admins, SMT and assessment managers publish, and can bulk-upload PDFs at /reports/documents. \[DB\]
- **FR-8.10** On the Termly Grade Report a special result set (FR-7.31) replaces the week column its date falls in, headed by its name (Year 12 Mock 1, dated Monday 5 October 2026, replaces Year 12's Wk3 column). Weeks start on Mondays and a date goes to the nearest one, so Friday to Sunday count towards the following week's column; subjects not in the set show grey. A set matching no week, or a second set in the same week, gets its own column after the weeks. Other year groups' reports are unchanged. The written report includes special-set marks like any other mark in the term. Transcripts never show them: they read only end-of-term exam sets and legacy transcript grades. \[DB / Page\]

## 12. FR-9 Tuckshop

Students pre-order within fixed weekly windows, with at most 2 food items per tuckshop day, and are charged only when the order is handed out.

**Ordering (/portal/tuckshop)**

- **FR-9.1** Only students order, and only for themselves. Parents see balances and purchases but can't order. Orders are made or changed only through Formwork's ordering function. \[DB\]
- **FR-9.2** One order per student per tuckshop day; saving replaces the basket, and cancelling keeps it on record as cancelled. \[DB\]
- **FR-9.3** Students can order, change or cancel only while that day's window is open (below). In the last 12 hours they see a red warning saying whether they've ordered. \[DB / Page\]

| Tuckshop day | Ordering opens | Ordering closes |
| --- | --- | --- |
| Wednesday | Monday 5:00pm | Tuesday 9:00am |
| Saturday | Wednesday 7:00pm | Thursday 11:00pm |

- **FR-9.4** Tuckshop, bursar and admin edit the schedule at /tuckshop/ordering, and can close student ordering until a future date (it reopens at midnight on that date). Closing doesn't clear existing orders. \[DB\]
- **FR-9.16** The Tuckshop card on the staff dashboard (and the bursar's home page) shows a green "Ordering open" or red "Ordering closed" badge, with when the window closes or the next one opens, e.g. "Wednesday 7 October orders open 7pm on Monday 5 October". It follows the weekly rota, special sessions and the manual closure, and rechecks every minute; it links to /tuckshop/ordering. It only reports: the database still decides whether an order is accepted (2 Oct 2026). \[Page\]

**Limits**

- **FR-9.5** At most 2 of any one item, and at most 2 food items (drinks included) per tuckshop day, counting what has already been handed out. Non-food items have no total limit; the Water Bottle is not food. These apply to staff too. \[DB\]
- **FR-9.6** Only items switched on for sale can be ordered. Whether an item is food is set on Items & Prices. \[DB\]

**Special sessions**

- **FR-9.7** A one-off window (e.g. Independence Day) with its own times, items and limits (per item, food, other). It replaces the weekly window for its date and ignores a manual closure. \[DB\]

**Money**

- **FR-9.8** A balance is the student's Tuckshop charges on their fee invoice minus their purchases. Nothing is charged at ordering; the price used is the item's price when handed out. There is no balance check, so a balance can go negative. \[DB\]
- **FR-9.9** Top-up: staff enter a target balance (default ₦40,000) and the difference is added to the fee invoice as a Tuck Shop Recharge, for one student, a form, a year or everyone. \[DB\]
- **FR-9.15** Paid top-up (/bursar/tuckshop-top-up, bursar only): the bursar first records the money on Record a Payment, then picks that payment and adds all or part of it to the student's balance. It adds a Tuck Shop Recharge line on the payment's own invoice, so the payment already covers it and no unpaid bill is created. Each line records the payment it came from; a payment can't be added for more than it was, and can't be deleted while credit taken from it remains. Not shown on /bursar/audit, so no undo there. The page lists all of a student's payments, so the bursar must pick only money sent in as tuckshop credit. (Migration 273.) \[DB\]
- **FR-9.10** Counter sales at /tuckshop/purchase have no limits and no window. \[DB\]
- **FR-9.16** Group sale (/tuckshop/purchase, "A group"): staff choose an active item and how many each, load a form, year group, restaurant or student group, and tick each student getting it. Only the ticked students are charged, one ordinary purchase each at the item's current price. It is all or nothing: a leaver among them, or any error, charges nobody. Charged students are marked and can't be ticked again on that screen. Same roles as counter sales; the seller is the signed-in person. (Migration 350.) \[DB / Page\]

**Hand-out (/tuckshop/hand-out)**

- **FR-9.11** Open to the tuckshop and tuckshop\_owner roles only; admins and the bursar can't use it. \[DB\]
- **FR-9.12** Tapping a student marks the order given and charges it; tapping again undoes it and refunds exactly. Staff can record fewer items than ordered when stock ran out, and the student pays only for what they got. \[DB\]
- **FR-9.13** Save and lock freezes a restaurant's list for the day, recording the numbers, value, who and when. Only tuckshop\_owner can unlock; being admin is not enough. Every save and unlock is kept. \[DB\]
- **FR-9.15** Not collected marks an order the student never came for: nothing is charged, and it can be undone until the list is saved. It is kept apart from a cancelled order (withdrawn before the day), and the saved totals count it as not given. \[DB\]
- **FR-9.14** Order sheets print per restaurant for a delivery date, marked PROVISIONAL until the window closes. \[Page\]

## 13. FR-10 Fees

The bursar runs invoices, charges, payments and discounts; parents see a term's fees only once SMT publishes that term.

- **FR-10.1** Each student has an invoice per fee term, made of charge lines from the fee catalogue (tuition, boarding, tuckshop and so on). Prices change only by two-person approval (FR-10.8). Only the bursar creates invoices, adds or deletes charges, records payments and applies discounts. \[DB\]
- **FR-10.2** The bursar or SMT can charge a group of active students (one student, a form, a year or everyone) in one batch, and undo the batch. \[DB\]
- **FR-10.3** Discount types (fixed or percentage) are defined by the bursar, assigned to a student for a term and applied to their invoice; SMT can read them. There are no payment plans or instalments. \[DB\]
- **FR-10.4** An invoice's status is worked out automatically after every payment or charge change: unpaid (nothing paid), part-paid, or paid (paid at least the total). \[DB\]
- **FR-10.5** Nobody can edit or delete a payment or an invoice through the app. "Recorded by" on payments and "created by" on charge batches are always the signed-in person. \[DB\]
- **FR-10.6** The bursar and SMT see all fees. Parents see their own children's, only for terms SMT or admin has published. \[DB\]
- **FR-10.7** Fee changes are logged permanently in Change History, which the bursar can't read, because part of its purpose is checking fee changes. \[DB\]

**Price approval (two people)**

- **FR-10.8** No one can change a price directly: fee item prices, year-group prices, and each academic year's admission form fee and deposit can only change through an approved proposal. This includes giving a new fee item a price. \[DB\]
- **FR-10.9** The bursar, SMT, the principal, the college secretary, admins and anyone with the Lookups page can propose a price change. A proposal is refused if an amount is negative, unchanged, or another proposal for the same price is still pending. \[DB\]
- **FR-10.10** A change takes effect only when both the **principal** (principal@) and the **college secretary** (cs@) approve it, as two different people. It then applies at once. Being an admin doesn't count as either. \[DB\]
- **FR-10.11** Either approver can reject a proposal, with a written reason; the proposer or either approver can cancel it while it is pending. Proposals are never deleted and every step is logged in Change History (fees). \[DB\]
- **FR-10.12** Proposals are made and approved at /bursar/fee-approvals (bursar, SMT, principal, college secretary; Approve and Reject buttons only for the two approvers). Admission fees can also be proposed from Lookups and the admission-forms page. \[DB / Page\]

**Locked fee items**

- **FR-10.13** Tuition, activity, technology and medical items are **locked**. They can have one approved price per year group (7–12), set as a single proposal for all six years. \[DB\]
- **FR-10.14** A charge for a locked item must equal the approved price for the student's current year group, or failing that the item's approved single price; otherwise it is refused. This applies to everyone signed in; only changes made directly in the database are exempt. Charge Checklist fills in the locked price and doesn't allow another amount. \[DB / Page\]
- **FR-10.15** Damages, tuckshop and discounts are not locked and can be charged at any amount. Charges already on invoices before locking were left as they were. \[DB\]
- **FR-10.16** A fee item added with, or changed to, a tuition, activity, technology, medical or exam category is locked automatically, so it can have year and term prices and is charged only at them. The app can't set or remove the lock itself. (Migration 340.) \[DB\]
- **FR-10.17** Prices by year and term: a locked item can have an approved price for each school term and year group, proposed at /finance/term-fees and approved by both approvers. Charging and the forecast take the term price, else the year price, else the single price. Year 12's Term 2 price covers Terms 2 and 3 (Term 3 is ₦0). A fee term finds its school term through a link: "1st Term" is the September Term 2026 and "2nd Term" the January Term 2027 (set up 3 Oct 2026, not yet current or published). (Migrations 343, 349.) \[DB\]
- **FR-10.18** Each fee item can be limited to the school terms it is charged in; a charge in another term is refused, and the forecast leaves it out. No terms chosen means every term, as for all items today. (Migration 348.) \[DB\]
- **FR-10.19** Add a fee (/bursar/fee-items) is one numbered form: (1) name, what parents see, category, optional; (2) the fund; (3) the terms; (4) prices, sent for two-person approval. Only the principal or the college secretary can choose the fund. (Migration 348.) \[DB / Page\]
- **FR-10.20** Each fee item pays into one fund (FR-19.1), set by the principal or the college secretary and fixed once the item has been charged. Each payment is shared between its invoice's funds in proportion to what each is still owed, and stored when recorded; an overpayment is credit in the general fund. (Migration 338.) \[DB\]
- **FR-10.21** A discount type can be marked as a sibling discount (for example 3rd child and later). Discounts suggests active students whose place among their active siblings (oldest first by date of birth; "Other" links don't count) qualifies, and the bursar confirms each. Percentages keep seven decimals, so a bursary such as "pays ₦500,000 of ₦1,500,000" comes to the exact naira. (Migration 343.) \[DB / Page\]
- **FR-10.22** Naira in database messages and admission letters are shown as whole numbers. (Migration 345.) \[DB\]

**Pages**

| Page | What it does |
| --- | --- |
| /bursar/charge-checklist | Pick a term and fee item, select students, charge them in one batch; shows who already has it |
| /bursar/fee-items | Add a fee in one numbered form (name, fund, terms, prices sent for approval); edit items' name, category and optional flag |
| /bursar/discounts | Define discount types, assign and apply them |
| /bursar/payments | Find a student and term, see invoice lines and payments, record a payment (amount, method, reference, date), download the invoice PDF |
| /bursar/fees-table | Charged, paid and balance for every active student this term |
| /bursar/debtors | Students owing for a term, with parent phone and email; CSV export |
| /bursar/audit | The last 100 charge batches and who made them; undo a batch |
| /smt/fees-dashboard | Collection totals by year group and fee item; the Publish to parents / Hide switch (SMT and admin) |

## 14. FR-11 Pastoral, boarding, clinic and HR

Medical records are visible only to the nurse and the Designated Safeguarding Lead (not admins, migration 363); HR records only to HR and SMT; boarding views default to the houseparent's own house.

**Boarding and pastoral**

- **FR-11.1** Houseparents' student and behaviour pages default to their own house. Those with other school-wide jobs get a "Whole school" switch. This is a display filter; all staff can read every student. \[Page\]
- **FR-11.2** The head of boarding has houseparent powers across all houses and counts as pastoral for detentions, appeals and editing events. \[DB\]
- **FR-11.3** A mentor's students are the students in their mentor-group class. \[DB\]
- **FR-11.4** /pastoral/birthdays shows the next 7 days of birthdays (up to 31) to admin, SMT, pastoral, houseparent and school office. Today's names are shown to staff and students after sign-in, never to parents. Leavers are excluded. \[Page\]
- **FR-11.8** Unallocated Students (/pastoral/unallocated, migration 320, 2 Oct 2026) lists active students with no boarding house, no boarding room, or a gap in their week. A period counts as a gap only if another active student in the same year group has a lesson then (for The Other Half, if the current OH term has an activity open to that year that day), so a year group's free periods aren't reported. A lesson of any of the student's classes, or an OH choice, fills the slot. It shows names, year, form, house and room only, and returns nothing to anyone without the page. When built, 2 of 278 active students had no house, 13 no room, and 43 Year 7s were in neither Evening Prep group. \[DB / Page\]

**Clinic**

- **FR-11.5** The clinic holds each student's medical profile and consents, conditions, growth and BMI, sick-bay visits, immunisations, and termly resumption screenings (one per student per term per type). \[DB\]
- **FR-11.6** Only the nurse and dsl (Designated Safeguarding Lead) roles can see any of it (migration 363, the principal, 4 Oct 2026). The nurse can view, add, edit and delete; the DSL can view, add and edit, but not delete. Admins, the principal role, teachers, pastoral staff, houseparents, students and parents have no access. \[DB\]
- **FR-11.9** Who sees medical records is padlocked at /admin/permissions for all seven medical tables: it can't be ticked or unticked there, by admins either, and changes only by a migration the principal agrees. \[DB\]
- **FR-11.10** A DSL can mark a sick-bay log entry as safeguarding, when recording it or later on any entry, a nurse's included (migration 364). The presenting complaint and observations then move to a table only the DSL can read, and the entry shows "Safeguarding: details held by the DSL" to everyone else, the nurses included. Medication, dose, treatment, temperature, visit type, outcome, parent told and follow-up stay visible to the nurses. \[DB\]
- **FR-11.11** Only a DSL can set or remove the safeguarding mark; a nurse who tries is refused. Removing it puts the complaint and observations back on the entry. Who marked it and when are stamped by the database. The page offers the tick box and the Mark as safeguarding button to DSL holders only. \[DB rule; Page display\]
- **FR-11.12** Admins still see the Clinic tile (the principal's choice, 4 Oct 2026), but any Clinic page opened by someone without the nurse or dsl role shows "Access not allowed: clinic and medical records are for the nurse and the Designated Safeguarding Lead only" instead of empty lists. A student's profile shows the Medical tab, and its edit buttons, only to the nurse and the DSL. \[Page; the data is already refused by FR-11.6\]

**Staff HR**

- **FR-11.7** /staff/records holds each staff member's profile, training, warnings, and absence and lateness records. HR and SMT can read; only HR and admin can edit. HR can also edit the core staff record but not delete staff. Nationality is Nigerian, British or Other. \[DB\]

## 15. FR-12 Communications and email

Every email goes through one queue from mis@abc.sch.ng with a Reply-To chosen by kind; group messages go to the Formwork inbox only.

**Messages (/comms)**

- **FR-12.1** SMT, pastoral, school office and admins can send messages to an individual, all staff, one or more staff roles, or a group of students: all students, or one or more year groups, forms, boarding houses, mentor groups, sports houses, teaching classes, Other Half activities or student groups. A student group message goes to the students, their parents, or both, chosen when sending. \[DB\]
- **FR-12.2** A message to one person is emailed as well as put in their inbox. In a group message, parents are emailed too, unless parent emails are paused; students and staff get it in their inbox only. Group messages reach active students and their parents only, and parents with no login can't be reached. \[DB\]
- **FR-12.3** Everyone sees only their own inbox, with read receipts. Automatic detention and behaviour notices are also readable by SMT, pastoral and school office. \[DB\]
- **FR-12.4** /comms/history lists sent messages and automatic emails with recipients, subject and delivery status, never the body (welcome emails contain passwords). For SMT, pastoral, school office and admin. \[DB\]
- **FR-12.8** "Check recipient count" gives the real number before sending, from the same list the send uses, and says how many parents in the group have no login and won't get it. \[DB\]
- **FR-12.9** Message history shows who a student group message went to: students, parents or both. \[Page\]

**Email**

- **FR-12.5** Every email is queued and sent from mis@abc.sch.ng through Google Workspace, about 12 a minute, retrying failures up to 6 times. The sending key is held in the database vault; if it's missing, nothing is sent but the action still succeeds. \[DB\]
- **FR-12.6** Every email carries a Reply-To, set by kind at /admin/email-replies (SMT and admin). Changes are logged. \[DB\]

| Email | Replies go to |
| --- | --- |
| Message to a parent | sro@ |
| Message to staff or a student | The member of staff who sent it |
| Welcome letters | sro@ |
| Behaviour alert | guardian.counselling@ |
| Detention notices | All SMT |
| Mark appeal (to the teacher, Head of Department in cc) | sro@ |
| Anything else | sro@ |

- **FR-12.7** One admin switch pauses every email to parents; inbox copies are still delivered. It is currently off (emails are sent). \[DB\]

## 16. FR-13 Calendar, terms and administration

SMT own the calendar and terms; admins own setup, imports, permissions and backups.

**Calendar (/calendar)**

- **FR-13.1** Staff see the academic calendar of terms and events. SMT and admins add, edit and delete events; each has a date, name, category, optional year-group note and a "result set" flag; the One Year category makes a special result set for the year groups ticked (FR-7.31). \[DB\]
- **FR-13.2** Adding a report-period event also creates the report period, with its year groups and due dates. \[Page\]
- **FR-13.3** SMT add and edit terms; only admins delete a term (it also deletes that term's OH programme). \[DB\]
- **FR-13.4** Parents see a read-only calendar of term dates and events, without staff deadlines. \[Page\]
- **FR-13.7** Parents can subscribe to the school calendar from /parent-portal/calendar (iPhone, Mac and Outlook; Google; or copy the link). Each parent has a private link that their calendar app re-checks every few hours, so moved or cancelled events update on their phone by themselves. A parent can make a new link, which stops the old one working. The feed holds events from the current academic year on, without Teacher Assessment weeks or report periods, and goes empty once none of their children is still at the school. The one-off download buttons remain, labelled as copies that won't update. Staff don't see the subscribe card, including in View as Parent. (Migration 274.) \[DB\]

**Home dashboard**

- **FR-13.5** Staff see a top row of big tiles (My Timetable, Calendar and, for staff who are also parents, My Children, and Class Progress for Heads of Department, SMT and admins, FR-7.15), a second row (Log behaviour, Inbox with its unread count, and Missed Lessons with today's count for those who can open it, FR-4.16, and Homework Monitor for SMT, FR-17.19), and module cards underneath. Three cards carry a number beside their icon that links to its page: active students on Students, staff on Staff & Access, behaviour alerts in the last 7 days on Pastoral, each shown only to those who can open that page (migrations 292–294; the alerts page shares the Behaviour page's permission, so the alerts count shows to everyone with it — until 1 Oct 2026 it showed only to admin logins, not to staff who are admin by role, such as cs@). Each card shows only the pages the person's roles can open, and each page is on one card only: Detentions, Certificates and Behaviour Appeals are on Pastoral, Class Allocation on Timetable. A page with a big tile isn't also a link on a card (1 Oct 2026), so Missed Lessons and Homework Monitor are tiles only, and Class Progress stays on the Assessment card only for staff who don't get its tile. Students see big tiles (Timetable, Homework for students in a class with homework switched on, The Other Half, Assessment, Behaviour, Tuckshop, Messages, and Groups when they are in a group shown to students); parents go straight to their portal; a bursar sees Fees and Tuckshop only. \[Page\]
- **FR-13.8** The order of the big tiles on students' home page and of every row of the staff dashboard (the top row, the second row and the module cards, which the bursar's home page also uses) is set once for the whole school at /admin/tile-order (admins). Tiles not yet placed go after the ordered ones. The order never changes which tiles someone sees; page access and which classes have homework switched on still decide that. \[DB\]

**Administration pages**

| Page | What it does | Who |
| --- | --- | --- |
| /admin/permissions | Tick which pages each role opens and which student fields it can edit | Admin (write) |
| /staff/roles | Assign staff roles; warns when a houseparent has no house | HR, admin |
| /staff/mentor-groups | Assign one or two staff to each mentor group | Granted roles |
| /admin/lookups | Boarding houses, sports houses, behaviour categories and points, behaviour thresholds, detention room and time, certificate levels, academic years, admission fee proposals, mark appeal days and credits (FR-7.30), hours before parents see a mark (FR-7.34). Every section starts folded closed and opens when clicked (4 Oct 2026) | Admin, SMT, HR |
| /admin/student-numbers | Boys, girls and unknown by year, mentor group, boarding house and room (rooms counted within their house), restaurant and class | Granted roles |
| /admin/class-lists | Print class rosters by year, subject or class | HR, school office, admin |
| /admin/bell-times | Sessions and times for each weekday | Admin |
| /admin/subject-settings | Subject display names, departments, key stages, aliases, target fallback | Assessment manager, admin |
| /admin/grade-boundaries | Grade cut-offs per subject and year group | Assessment manager, admin (page); assessment managers edit (data) |
| /admin/email-replies | Reply-To for each kind of email | SMT, admin |
| /admin/tile-order | Order of students' big tiles and of every row of the staff dashboard, school-wide | Admin (all signed-in users read it) |
| /groups | Student groups: make, build from a rule, change, archive, message | SMT, pastoral, school office, admin (teachers look up only) |
| /admin/change-history | The permanent change log | SMT, admin |
| /admin/register-alerts | Late or missed registers | HR, school office, admin |
| /admin/backup | Freeze writes, run a backup, list recent backups | Admin |
| Imports | Students, parents, photos, staff emails, CAT4/NGRT, targets, Nova-T timetable and meetings, gradebook | Admin (gradebook: assessment staff) |

- **FR-13.6** Admins can freeze all changes for 1–60 minutes while a backup runs (see NFR-7). \[DB\]

## 17. FR-14 Admissions

Admissions tracks each applicant from enquiry to deposit paid through fixed stages; the stage only changes through Formwork's own actions, each of which can produce a standard letter. Enrolment into a student record is designed but not yet built.

**Access**

- **FR-14.1** Only holders of the /admissions page (the admissions role, SMT and admin) can read or change applicants and their contacts, scores, interviews and letters. Test days, papers, letter templates and the previous-schools list each need their own page too. \[DB\]
- **FR-14.2** The bursar can't read applicants. The bursar sees only name, year group, status, main contact, and form-fee and deposit payments, at /bursar/admission-forms. \[DB\]
- **FR-14.3** Changes and deletions to applicants, scores, CAT4, interviews and letter templates are logged in Change History (area "admissions"). Applicants are kept indefinitely. \[DB\]

**Application (/admissions/new)**

- **FR-14.4** An application records the child (names, date of birth, gender, nationality, entry year and year group 7–12, previous school and class, a sibling at the school, how they heard of us, notes) and 1–2 contacts, one of them the main contact (up to 4 later). First and last name are required. \[DB / Page\]
- **FR-14.5** A new application always starts as an enquiry. The page warns, without blocking, when the same name, date of birth and entry year already exist. \[DB / Page\]
- **FR-14.6** Previous schools are a shared list (name + town unique); duplicates can be merged, and a school in use can't be deleted. \[DB\]
- **FR-14.7** Entry year can't change after the enquiry stage, nor entry year group once a test is booked. Only an enquiry can be deleted (admins: any). \[DB\]

**Entrance tests (/admissions/sessions, /admissions/papers)**

- **FR-14.8** A test day belongs to one entry year, with date, time and venue. Each entry year and year group has at most one English and one Maths paper, each with a maximum mark. \[DB\]
- **FR-14.9** A score must be for the paper matching the applicant's entry year and year group, from 0 up to the maximum. CAT4 SAS scores are recorded too (0–200). The test-day page prints a candidate sheet and takes scores in a grid. \[DB / Page\]
- **FR-14.10** English %, Maths % and their average are worked out automatically; "passed" means the average reaches the entry year's pass mark (default 50). The pass mark only guides the decision; nothing blocks inviting a child below it. \[DB\]

**Interview**

- **FR-14.11** One interview per applicant: date, interviewer, reading age (36–240 months, entered as years and months), reading test, interests (19 fixed plus free text), languages, strengths, concerns, recommendation (offer, waitlist or reject) and comments. \[DB / Page\]

**Stages**

- **FR-14.12** Stages: enquiry, form paid, test booked, tested, invited to interview, interviewed, waiting list, unsuccessful, offered, accepted, deposit paid, withdrawn (and enrolled, not yet reachable). The app can't set a stage directly. \[DB\]
- **FR-14.13** Moves: the bursar records the form fee (enquiry → form paid); admissions books a test day (→ test booked); entering English, Maths and CAT4 moves to tested; saving an interview moves to interviewed; the bursar records the deposit (accepted → deposit paid). Every other move is a decision by admissions staff, limited to the moves below. Inviting to interview needs a date and time; withdrawing needs a reason. Admins can make any decision move. \[DB\]

| From | Can move to |
| --- | --- |
| Enquiry, Form paid | Withdrawn |
| Test booked | Tested, Withdrawn |
| Tested | Invited to interview, Waiting list, Unsuccessful, Withdrawn |
| Invited to interview | Interviewed, Unsuccessful, Withdrawn |
| Interviewed | Offered, Waiting list, Unsuccessful, Withdrawn |
| Waiting list | Invited to interview, Offered, Unsuccessful, Withdrawn |
| Offered | Accepted, Withdrawn |
| Accepted, Deposit paid | Withdrawn |
| Unsuccessful, Withdrawn | None |

**Letters (/admissions/letters)**

- **FR-14.14** Seven standard letters: test date, invite to interview, offer, and waiting-list and unsuccessful letters in "after test" and "after interview" versions. Staff edit their subject and body; merge fields fill in the child's and parent's names, year, test and interview details, fees and date. \[DB\]
- **FR-14.15** The stage move chooses the letter. It is saved permanently against the applicant and, if the sender leaves "email" ticked, emailed to the main contact, with replies going to the sender. It isn't emailed when parent email is paused or the address isn't valid; the reason is shown. A letter with an empty template is skipped with a note. A PDF can be downloaded but isn't attached to the email. \[DB / Page\]

**Fees (/bursar/admission-forms)**

- **FR-14.16** Each academic year has an admission form fee, deposit (₦100,000 for 2026/27 and 2027/28) and pass mark. The form fee is not yet set, so form payments can't be recorded yet. Fee amounts change only by two-person approval (FR-10.8). \[DB\]
- **FR-14.17** The bursar records the form fee (date not in the future, receipt number; the amount comes from the year) and the deposit (amount pre-filled, not checked against the year's deposit). The page shows totals received. \[DB / Page\]

**Home tile**

- **FR-14.18** The Admissions tile links to Applicants, New Application, Test Days, Test Papers, Standard Letters and Previous Schools, and shows applications and accepted for next year. \[Page\]

**Next Year's Numbers (/admissions/projections)**

- **FR-14.19** SMT set the **new places** for next year in each year group, boys and girls separately: how many new pupils the school will admit, not the whole year size. For 2027/28 that is 11 boys and 11 girls into Year 7, and none elsewhere. Only holders of the Places Allowed page (SMT, admin) can set them; changes are logged. \[DB\]
- **FR-14.20** For each year group the page shows, boys and girls separately:
  - **New entrants:** places allowed, confirmed (accepted, deposit paid or enrolled), places still free, offers awaiting a reply, applicants still in process, and predicted free places.
  - **Carried over:** this year's active students moving up; Year 12 leave. They don't use up new places.
  - **Total:** next year's confirmed and predicted roll. \[Page\]
- **FR-14.21** Predictions count 100% of offers and 50% of applicants still in process by default; staff can change both percentages on the page. Places over the limit show in red. \[Page\]

**Designed, not built yet:** enrolling an accepted applicant as a student (admission number, UPN, login, parent records, CAT4), removing old applicants' personal data, and showing interests to the Other Half coordinator. Until enrolment is built, an applicant's interview reading age doesn't reach their reading-age history as a student (FR-7.17).

## 18. FR-15 Academic years and next year setup

Next year is planned in separate "plan" tables that nothing live reads, so planning can't disturb this year; the switch-over itself is not built yet.

**Academic years (Lookups)**

- **FR-15.1** Academic years run 1 September to 31 August, labelled like 2026/27, each planning, current or closed, with exactly one current. 2026/27 is current and 2027/28 is planning. Every signed-in user can read them. \[DB\]
- **FR-15.2** Lookups holders can add the next year, change a year's dates (no overlaps; terms are re-filed by date) and delete a planning year that has nothing attached. Which year is current can't be changed from any page. Changes are logged. \[DB\]
- **FR-15.3** The staff calendar shows this academic year by default, with earlier years and "All years" available. Result-set lists are in date order, grouped by school year with this year first. \[Page\]

**Next Year Setup (/admin/next-year, SMT and admin)**

- **FR-15.4** Step 1, mentor structure: next year's mentor groups (per year group) and their mentors. "Start from this year's groups" moves Y7–Y11 groups up a year with their mentors, drops Y12 and repeats the Y7 names. The structure is confirmed (stamped who and when) and can be reopened. \[DB / Page\]
- **FR-15.5** Step 2, next year's Nova-T timetable: imported into the plan tables with the same importer, only for a planning year whose mentor structure is confirmed. \[DB\]
- **FR-15.6** Step 3 lists next year's planned classes with subject, teacher, room, lessons and students. \[Page\]

**Designed, not built yet:** placing students into next year's classes, each student's progression (move up, leave, repeat), subject choices for Y9 and Y11→Y12, mapping this year's classes to next year's, a readiness check, and the automatic year switch the evening before Term 1 (with reminders).

## 19. FR-16 Audit trail

Formwork keeps a permanent record of every sensitive change: who made it, when, and what it was before and after. Most of it can be searched on screen today; behaviour-event edits are recorded but have no screen yet. The trail starts from the SIMS import in September 2026, because SIMS's own history was not exported.

**How the trail is kept**

- **FR-16.1** The two main logs, Change History and Grade History, are append-only. Nobody can edit, delete or wipe an entry, even from the database editor. \[DB\]
- **FR-16.2** "Who" is always taken from the signed-in account, with that person's name as it was at the time, never from anything the page sends. Changes made directly in the database are labelled "Principal (direct)". \[DB\]
- **FR-16.3** Each entry keeps the whole record before and after the change. Saves that change nothing are not logged. \[DB\]
- **FR-16.4** "Created by", "recorded by" and "saved by" columns (payments, charge batches, tuckshop sales, hand-out locks, admission records, places allowed) are stamped from the signed-in account, overwriting whatever the page sent. \[DB\]
- **FR-16.5** Stage 5 events returned to the teacher are also kept in their own record (FR-6.28): teacher, reviewer, time, note, and the category and points before the return. Only the return step can add to it, and the app can't change or delete it. SMT and admins read it as a count per teacher on Behaviour Review; the event's own changes are in Change History (behaviour). \[DB\]

**What can be seen, where, and by whom**

| Record | What it keeps | Where to see it | Who can see it | Working today |
| --- | --- | --- | --- | --- |
| Change History | Registers (changes and deletions, and planned absences), fees and prices, fee approvals, academic years, behaviour events, the other students in serious events, thresholds and certificate levels, roles, permissions, ability ticks and logins, parent links, email settings, admissions, student groups (the group, its students and its staff), student records (every student added, changed or deleted; the photo is noted as changed but not copied), school reading tests (added, changed or removed), finance (funds, forecast numbers, term budgets, contingency releases, suppliers and requisitions), prep times and days with no homework | /admin/change-history: filter by dates, area, student, person and action; latest 500; CSV download | SMT, admin | Yes |
| Grade History | Every score, target, transcript grade, homework grade and student group mark entered, changed or deleted, with old and new grade. Homework grades and group marks are hidden unless chosen, and only SMT and admins can read them | /assessments/grade-history: filter by dates, student, person, grade and action; flags where the person signed in differs from the teacher on the record; latest 500; CSV download | SMT, assessment managers, admin | Yes |
| Mark appeals | Every appeal: the mark appealed, the student's reason and claimed mark, the outcome, the corrected mark, the teacher's note, who decided and when; never deleted (the corrected mark is also in Grade History) | /grade-appeals (waiting and decided) | The teacher (their students), Heads of Department (their department), SMT, assessment managers, admin; the student their own | Yes |
| Fee price proposals | Each proposal, who made it, both approvals or the reason for rejecting | /bursar/fee-approvals | Bursar, SMT, principal, college secretary | Yes |
| Charge batches | The last 100 group charges and who made them | /bursar/audit, with undo | Bursar | Yes |
| Requisition timeline | Every step of each requisition (raised, signed, costed, approved, contingency released, received, paid, cancelled), who and when; practice entries cleared, never deleted | Each requisition on /finance/requisitions | Principal (while the budget is built) | Yes |
| Admission letters | Every letter produced, as sent, who sent it and the email address | Each applicant's page | Admissions, SMT, admin | Yes |
| Sent messages and emails | Every message and automatic email, recipients and delivery status (never the body) | /comms/history | SMT, pastoral, school office, admin | Yes |
| Tuckshop hand-out locks | Every save and unlock, numbers given and value | /tuckshop/hand-out | Tuckshop, tuckshop owner | Yes |
| Register alerts | Every register not taken 15 minutes after the start | /admin/register-alerts | HR, school office, admin | Yes |
| Behaviour event edits | Old and new comment and category for every edit | No screen yet | Database only | Recorded, not viewable |
| Missed-lesson alerts seen | Who pressed "Seen" on each missed-lesson alert, when, and their note (migration 309) | No screen yet | Database only | Recorded, not viewable |

**What is not recorded**

- **FR-16.5** Taking a register for the first time (only later changes are logged). \[DB\]
- **FR-16.6** Changes to grade boundaries, subject aliases and key stages. \[DB\]
- **FR-16.7** Who looked at or downloaded a record: Formwork logs changes, not viewing. \[DB\]
- **FR-16.8** Anything before the September 2026 import from SIMS, including class and subject-choice changes. \[Data\]
- **FR-16.9** Who added a student, and changes to student records, before 30 September 2026 (logged from migration 286). \[Data\]
- **FR-16.10** A student ticking homework done or unticking it. The tick keeps its own time, but unticking leaves no trace. \[DB\]

## 20. FR-17 Homework

Teachers set homework for a class with a deadline and a grading system, and record a grade for each student. The grades inform the end-of-term written report (FR-17.12) but never transcripts, result sets or target grades. It began as a pilot on 10\_1/Ma and 11\_1/Ma was opened to every Year 10 and 11 teaching group on 30 September 2026 (migration 295) and to every teaching group in Years 7–12 on 4 October 2026 (migration 353). The design and the principal's decisions are in docs/homework-design.md.

**Which classes, and access**

- **FR-17.1** Homework can be set only for classes an admin has switched on. Switching a class off stops new homework but keeps everything already set and marked. Every teaching class in Years 7–12 is switched on (migration 353, 4 October 2026; Years 10 and 11 only from 30 September) except mentor groups, Prep (supervised study, not a taught subject) and Year 12's Personal Study (private study); a new class, from a later timetable import or next year's timetable, is switched on automatically unless it is one of those (migrations 296 and 353). An admin can still switch a class off, and a re-import doesn't switch it back on. \[DB\]
- **FR-17.2** /homework is granted to teachers, Heads of Department and SMT (and admins). The page shows the person's own classes (those they teach, or teach a lesson of) as buttons. A drop-down holds the other switched-on classes in the subjects they teach, marked view only (what was set, with instructions and files, but no grades and no editing), plus any class they manage as Head of Department or admin; a Year 7–9 teacher sees that it isn't switched on for their classes yet. \[DB\]

**Setting homework**

- **FR-17.3** Homework is set from the class register (/attendance, a Homework panel for classes the teacher can set it for) or from /homework. Each piece has a title of at most 10 characters (so it fits the mark sheet; the database refuses a longer title on new homework or a changed title, migration 290), plain-text instructions, a deadline date, optionally the lesson it is due in (one of the class's lessons that day), and a grading system. \[Page\]
- **FR-17.4** Setting, editing and marking are open to the class teacher, the teacher of any single lesson of the class, the Head of Department for the subject, and admins. \[DB\]
- **FR-17.5** The subject, class code, year group and academic year are copied from the class, never taken from the page, so homework survives the class being removed at the year switch. \[DB\]
- **FR-17.6** Once any grade is recorded, the grading system can't be changed and the homework can't be deleted, only withdrawn. \[DB\]
- **FR-17.7** The teacher can attach files (PDF, Word, PowerPoint, Excel, OpenDocument, images, text or CSV, up to 20 MB each) and https:// links. The same people who can set the homework add or remove them. Files are private and open through a link that lasts ten minutes. \[DB\]
- **FR-17.20** Each homework says how long it should take (5 minutes to 4 hours; 30 unless the teacher changes it) and is done in prep on the evening before its deadline: the year's last prep evening before it, in term and not a holiday, so Sunday for a Monday deadline. The database works the evening out, never the page, so homework set weeks ahead still lands the evening before. It refuses a new homework, or a change to its time or deadline, when that evening has passed or when any student in the class (who has joined by the deadline) wouldn't have that much homework time left that evening, counting their homework from every class; the message names up to five of them. The form shows the evening and the least time any student has left. Editing only the title or instructions, withdrawing or restoring isn't re-checked. Homework set before 4 October 2026 counts as 30 minutes on the evening before its deadline. (Migration 352.) \[DB / Page\]
- **FR-17.21** Prep Times (/pastoral/prep, on the Pastoral card; admin, SMT, pastoral and head\_of\_boarding) holds each year group's prep: start and end, the days it runs, the fixed activity that isn't homework time and its minutes, and whether timetabled Personal Study lessons count. As set on 4 October 2026: Years 7–9 7.00–9.15 pm less the first hour reviewing the day's work (75 minutes), Years 10–12 7.00–9.45 pm (165 minutes), Sunday to Friday; no year counts private study yet (it is meant for a future Year 13). A student's homework time on a day is their year's prep less the fixed activity, plus counted Personal Study lessons that day; none outside term or on a holiday. Changes are logged in Change History and don't move homework already set. (Migration 352.) \[DB\]
- **FR-17.23** Days with no homework (migration 353, the principal, 4 October 2026): Prep Times lists blocked days for a year group, each with a reason (mock exams, a trip). On a blocked day no homework for that year can be due, and its evening has no homework time, so homework goes on the prep evening before. The homework form leaves those days out of its lesson picks and explains why if one is typed in. Homework already set isn't moved. The same people as Prep Times add and remove them; changes are logged in Change History. First use: Year 12's mocks on Thursday 8 and Friday 9 October 2026. \[DB / Page\]

**Grading systems**

- **FR-17.8** Teachers pick from: Mark out of …, Percentage, A\*–U, 9–1, WAEC, Effort 1–4, Complete / Incomplete, or Not graded. Every system also accepts "Not handed in" and "Excused". Lookups holders edit the systems; a system is retired, never deleted, so old grades stay readable. \[DB\]
- **FR-17.9** A grade must fit the system (a mark between 0 and the maximum, or one of its grades) and can only be recorded for a student in the class. A mark is converted to a grade from the subject's boundaries for the class's year group (11 out of 14 is 79%, a B). The database works the grade out and ignores any grade sent with a mark; a percentage between two bands takes the lower one, and changing a boundary later doesn't regrade saved marks (migration 289). \[DB\]

**Who sees what**

| Who | What was set, with files | Grades |
| --- | --- | --- |
| Class's teachers, Head of Department, admin; a student's current subject teacher for that student's marks in the subject (FR-17.16) | Yes | Yes, and can record them |
| SMT | Yes | Yes |
| Other staff (mentors, pastoral, assessment managers) | Yes | No |
| Students | Their own classes', this school year | Their own, once the teacher releases the marks |
| Parents | No | Only the Homework grade on a published written report |

- **FR-17.10** Students see homework on their weekly timetable, on the lesson it is due in, with a week selector, and on a Homework page laid out by day, with a list of overdue homework from earlier weeks. A graded homework shows its grade on its own card, where it was; there is no separate list of graded homework (the principal, 4 October 2026). \[Page\]
- **FR-17.11** Every homework grade entered, changed or deleted is logged permanently in Grade History, like any other grade. Only SMT and admins can read those entries, and /assessments/grade-history hides them unless "including homework" is chosen. \[DB\]
- **FR-17.12** Homework feeds the end-of-term written report only (migration 291). For each student and subject, the database works out the average of the term's number-marked homework from any class, its grade from the subject's boundaries, and how many were marked and not handed in. Every mark for homework due that term counts, released or not; Not handed in is counted separately, not as zero. The report writer shows these figures and pre-fills the Homework judgement from the average (80%+ Excellent, 60–79 Good, 40–59 Satisfactory, under 40 Needs Improvement), which the teacher can change; the period's assigned checkers see them too. The printed report's Homework line shows the grade only (e.g. B), never the percentage; a subject with no homework marks shows the teacher's judgement. Transcripts, result sets and target grades never use homework. \[DB / Page\]
- **FR-17.13** A student can tick their own homework as done, and untick it, until a grade is released. It is the student's own note, not a hand-in or a grade. They can tick only homework set for their class, and the time is recorded by the database. The class's teachers, the Head of Department, SMT and admins see how many students ticked each homework on the homework list and the register's Homework panel, and each student's tick in the mark book; classmates, other staff and parents don't. \[DB\]
- **FR-17.14** On the student's Homework page and timetable, colour shows where each piece stands: red for overdue or not handed in, amber for due today, green for ticked done, purple for graded, blue for due later. A ticked card shrinks to just the subject. Ticked homework no longer counts as due this week or overdue. \[Page\]
- **FR-17.15** Each class on /homework has a mark sheet: one row per student and one column per homework due between two dates (the current term by default), each column headed by the title and due date. It shows each student's average of their number-marked homework with its grade from the subject's boundaries, how many were marked and how many weren't handed in, and downloads as CSV. It shows only what the person may already see. \[Page\]
- **FR-17.16** Marks follow the student. If a student changes class or teacher, whoever teaches them in that subject now can read all their homework marks in it for the current school year, from any class. The teacher who gave the marks, the Head of Department, SMT and admins still see them, and the student still sees their own released marks. (Migration 291.) \[DB\]
- **FR-17.17** Student view: on /homework, staff can open any class shown there in "Student view", which draws that class's week of homework exactly as its students see it on their Homework page (week picker, coloured cards, detail panel with instructions and files), as a student who hasn't ticked anything or been graded. No student's ticks or grades are shown and nothing can be changed. \[Page\]
- **FR-17.18** Late joiners: Formwork records the day each student joins a class. Homework due before that day isn't shown to the student, and they are left out of its mark book, the list's marked count and the mark sheet (shown as ·), unless they already have a mark for it. Students already in a class on 1 October 2026 count as joining on 1 September 2026. (Migration 298.) \[DB / Page\]
- **FR-17.19** Homework Monitor (migration 311, /homework/monitor, a tile in the staff dashboard's second row; SMT and admins): homework as students see it, for a chosen week. For a year group it shows every class's homework due that week on the students' cards, each labelled with its class code, with a subject filter and a table of each subject's switched-on classes and which have nothing due that week. For one student in that year it shows their timetable with homework on the lesson it's due in and their Homework cards, with their own Done ticks and their grades once released. The student view comes from the database under the same rules as the student's own page (current school year, released marks only, homework due before they joined the class left out), and returns nothing to anyone without the page. In the year view each homework shows its marking, not the student's "Overdue": Not marked, Marked n of N, or Marked (not released), counted against the class's active students who had joined by the due date; the subject table adds a "Past due, not fully marked" column (2 Oct 2026). Nothing can be changed from it. \[DB / Page\]
- **FR-17.22** On their Homework page each day lists what to do that day ("To do"; Saturday and Sunday under Weekend): the homework on that evening's prep. A student can move a homework to an earlier day for their own planning ("I'll do it on…", from today up to the day before its prep evening) and back again. Once graded, it goes back to its prep evening and shows its grade there. Only the student writes or reads their own plans; staff don't see them, and a plan never changes the prep evening or the time check. Prep homework isn't shown on the timetable. (Migration 352.) \[DB / Page\]

**Not built yet:** students handing work in online (the principal's answer was "not yet"), and notifications: setting homework or releasing marks sends no email or inbox message.

## 21. FR-18 Student groups

SMT, pastoral staff and the school office make groups of students for activities, clubs, the prefects, interventions and messages, and can have the system build a group from a rule. Built 30 September 2026 (migrations 284–285 and 287); the design and the principal's decisions are in docs/student-groups-design.md.

**Groups and members**

- **FR-18.1** Only SMT, pastoral, the school office and admins can create a group, change its name, kind or visibility, archive it, or add and remove its students and the staff who run it. Teachers can open /groups and look groups up. \[DB\]
- **FR-18.2** All staff can see every group and who is in it. Students and parents see only the groups shown to them, never the other members (FR-18.17). \[DB\]
- **FR-18.3** Only current students can be added. A student who leaves stays listed, marked as left, and stops getting the group's messages. \[DB\]
- **FR-18.4** A group is archived, never deleted. An archived group can't be messaged or have students added. \[DB\]
- **FR-18.5** Students are added by name (the list of matching names as you type) or a whole year or form at once. Each group names the staff who run it; they can't change who is in it. \[Page\]
- **FR-18.6** A group records who can see it: staff only, the students in it, or the students and their parents. The portals show a group only where this allows it (FR-18.17). \[Page\]
- **FR-18.7** A student's profile has a Groups tile listing the groups they are in. \[Page\]

**Groups built from a rule**

- **FR-18.8** At /groups/build the person building chooses a rule and every setting each time (the principal: build settings must be editable). Negative behaviour: negative points between two chosen dates at or below a chosen threshold, withdrawn events not counted. Below target: latest grade below target in at least a chosen number of subjects, counting only results from a chosen date, compared by grade points and WAEC only against WAEC. Positive behaviour (migration 301): positive points between two chosen dates at or above a chosen total, withdrawn events not counted. Term exam average (301): the student's average percentage across their subjects in one chosen term exam, below or at/above a chosen mark; marks without a score are skipped, and last year's exams can be chosen, each student judged on the exam they sat. Attendance (301): present or late as a percentage of all register marks between two chosen dates, below a chosen percentage, leaving out students with fewer than a chosen number of marks. A subject (302): in one chosen subject, the latest grade since a chosen date below a chosen grade or below the student's target, compared by grade points and WAEC only against WAEC. All six can be narrowed by year, form and boarding house. A group can then be placed in an Other Half activity and locked (FR-5.14 to FR-5.17). \[DB\]
- **FR-18.9** "Show students" lists who matches today, with the reason; the builder can untick students before saving. Only students the rule picks can be saved, and a group can't claim a rule it wasn't built from. \[DB\]
- **FR-18.10** A built group records its rule, settings and date, is always staff-only, and never changes by itself; students can still be added or taken out by hand. "Build again" starts a new dated group from the same settings, which can be changed first. \[DB\]

**Messages and history**

- **FR-18.11** "Student group" is a message target: one or more groups, to the students, their parents or both, exactly like a year group (FR-12.1, FR-12.2). "Message this group" on a group's page opens the message with it chosen. \[DB\]
- **FR-18.12** Every change to a group, its students or its staff is logged permanently in Change History under Student groups. \[DB\]

**Group marks**

- **FR-18.13** A group can have mark sheets: a title, a date and a grading system from the homework list (Mark out of …, Percentage, A\*–U, 9–1, WAEC, Effort 1–4, Complete / Incomplete, Not graded). Marks are entered in a mark book on the group's page. \[Page\]
- **FR-18.14** A mark must fit the grading system, or be Absent, Not handed in or Excused, and can only be recorded for a student in the group. Once a sheet has marks its grading system can't change and it can only be withdrawn, not deleted; an archived group's marks can't be changed. \[DB\]
- **FR-18.15** The staff who run the group, SMT, pastoral staff, the school office and admins record and read the marks. Other staff see only that a sheet exists; students and parents see nothing. \[DB\]
- **FR-18.16** Group marks are outside reporting: never used by reports, transcripts, result sets or target grades. Every mark entered, changed or deleted is logged in Grade History, where only SMT and admins can read it and it is hidden unless chosen, like homework. \[DB\]

**Student and parent portals**

- **FR-18.17** A Groups tile appears on the student portal, the student home page and the parent portal when there is a group to show (migration 300). A student sees their groups marked "the students in it" or "the students and their parents"; a parent sees only those marked for parents, and only for children still at the school. Staff viewing as a parent see the parent's view. Archived groups, groups from an earlier school year and groups built from a rule are never shown. \[DB\]
- **FR-18.18** The portals show a group's name, description, kind and the staff who run it. They never show who else is in it, and never group marks. \[DB\]

## 22. FR-19 Budgets and requisitions

Fee income is shared into funds and spent through approved term budgets and requisitions (migrations 338–347; design and the principal's decisions in docs/finance-budget-design.md). It is a working draft: while it is built only the principal sees it, and as of 4 Oct 2026 every budget and requisition entered is practice.

**Funds (/finance/funds) and income (/finance/budget)**

- **FR-19.1** Funds (cost centres) are of five kinds: one general fund (tuition, less discounts), one contingency, one held fund (tuck shop money, the students' own, outside the budget), and any number of allocated funds and ring-fenced funds (direct charges such as swimming or exam entry, spent only on themselves). Added, renamed and archived by the principal or the college secretary; never deleted. \[DB\]
- **FR-19.2** Income shows, per fund and academic year, what has been charged and collected, from the stored payment shares (FR-10.20). Totals only; no student's name or payment. \[DB\]

**Forecast (/finance/forecast)**

- **FR-19.3** For a term, each fee item and year group: students paying × approved price (term, then year, then single price). The number starts from the live active headcount (compulsory items: everyone; tuition: everyone on the highest-priced tuition item; optional items: nobody) unless the principal or the college secretary enters one for that term; an entered number is changed, never deleted. Each discount or bursary type is its own line, from the active students who have it. A fee not charged in that term is left out. \[DB\]

**Term budgets and contingency (/finance/term-budget)**

- **FR-19.4** A term budget allocates money to each fund except the general fund and the tuck shop. Proposed by the principal or the college secretary and applied when both have approved; a newly approved budget replaces the term's last one. Cancelled, never deleted. \[DB\]
- **FR-19.5** Only the principal releases money from Contingency to a fund that would otherwise overspend, with a reason and the requisition that needed it. \[DB\]

**Suppliers (/finance/suppliers)**

- **FR-19.6** Approved suppliers are proposed by the principal, the college secretary or the bursar and approved by the principal and the college secretary together. Changing bank details sends a supplier back for approval. Suspended or archived, never deleted; bank details are seen only by those who see the budget. \[DB\]

**Requisitions (/finance/requisitions, /finance/approvals)**

- **FR-19.7** A requisition is raised by a member of staff, signed by the principal (the principal's own count as signed), costed (approved supplier, prices, fund) and approved by the college secretary (the college secretary's own are approved by the principal; nobody approves their own). The requester records delivery and the bursar pays, never more than the approved total. Every step is on the requisition's timeline. \[DB\]
- **FR-19.8** Approval is refused beyond the fund's remaining budget (the requisition then waits for a contingency release) and, for real entries, beyond the cash collected for the term. \[DB\]

**Practice and access**

- **FR-19.9** Every entry is practice or real, and the two never mix. In practice the principal can do every step and one approval completes a budget or supplier, so the process can be shown by one person. Clearing practice entries cancels or archives them all, recorded. \[DB / Page\]
- **FR-19.10** Only the principal sees the Budget tile and its pages: 1 Funds, 2 Fees, 3 Forecast, 4 Income, 5 Budget, 6 Suppliers, 7 Requests, 8 Approvals. Being an admin is not enough. Opening it to the bursar, SMT and the college secretary needs a later migration. Every change goes through a database function (the tables can be read, never written directly) and is logged in Change History under finance. \[DB\]

## 23. Non-functional requirements

The database, not the browser, decides who someone is and what they may do; sensitive changes are logged permanently; the whole database is backed up nightly.

**Security**

- **NFR-1** Every database policy and function identifies the caller from their sign-in, never from an ID sent by the page. Any student, staff or parent ID in a request is treated as a claim to check. \[DB\]
- **NFR-2** "Who did it" columns (payments, charge batches, tuckshop sales and hand-out locks, email settings) are stamped from the signed-in account, overwriting whatever the page sent. \[DB\]
- **NFR-3** Page visibility (/admin/permissions) is for display only and is never the security boundary. \[Design\]
- **NFR-4** Server routes check the caller first (the one exception, the parents' calendar feed, is checked by its secret link instead); the build fails if one doesn't, and no route uses the database's master key. \[Build check\]

**Audit**

- **NFR-5** Every sensitive change is kept permanently and can't be altered, even from the database editor. What is kept, where to see it and who can see it are set out in section 19, Audit trail. \[DB\]

**Backup and recovery**

- **NFR-6** A full database backup runs nightly and can be started by an admin. Kept: every backup for 14 days, Sunday backups for 8 weeks, 1st-of-month backups for 12 months. Only admins can download one, through a 60-second link. Photos and uploaded documents are not included. Supabase also keeps 7 daily backups. \[DB\]
- **NFR-7** Backup mode lets an admin freeze all changes for 1–60 minutes (default 30); it switches itself off at the deadline. \[DB\]

**Time and locale**

- **NFR-8** Every "today", "now", window and cut-off uses Lagos time (WAT, UTC+1), in the database and the browser. Currency is naira (₦). \[DB / Page\]

**Usability and capacity**

- **NFR-9** Every page works on a phone; staff often use Formwork from phones. \[Page\]
- **NFR-10** Sized for about 260 students, 60 staff and 1,000 parent logins. Email is sent at about 12 a minute. \[Design\]
- **NFR-11** The reads every open page repeats are worked out in the database for the person asking: the overdue-register count on staff timetables, the dashboard card counts and the "is this member of staff also a parent" check. At 08:00 on 2 Oct 2026 they slowed every request to 20–90 seconds as staff signed in (migrations 315–316). \[DB\]

## 24. Known issues and open decisions

36 places where Formwork does not behave as its pages suggest, or where a rule is weaker than it looks; six of them (6, 30, 31, 32, 33 and 36) have since been fixed. The first five stop something working today.

| # | Area | Issue | Effect | Status |
| --- | --- | --- | --- | --- |
| 1 | Results | Gradebook import and the quick-add form on /results send a result type ("Exam"/"ReLP") the database no longer accepts | They can't save; /results/enter is unaffected | Open |
| 2 | Certificates | Levels now come from Lookups (Bronze 100, Silver 200, Gold 500), which fixed the old 200-point mismatch. Totals may still read only the first 1,000 events | Totals may be low for some students; needs checking | Open |
| 3 | Subject settings | Assessment managers can open the page but only admins can save names, departments and target fallbacks | Saves by others change nothing, silently | Open |
| 4 | Results | Decimal scores such as 89.5 can fall between whole-number grade bands | Saved with no grade | Open |
| 5 | Behaviour | /behaviour/review page isn't granted to the school office, who release serious events without pictures | Office can't reach its review task. Decided 3 Oct 2026: only the principal's PA (who has the page) and SMT review Stage 5; migration 336 lets SMT release and return events without a picture | Decided: keep |
| 6 | Behaviour | Any staff member can change an event's parent visibility with a direct request | Review can be bypassed | Fixed |
| 7 | Behaviour | The weekly alert fires again on every further negative event that week | Repeat emails | Open |
| 8 | Behaviour | Deleting an event that already booked a detention probably fails | SMT can't delete it | Open |
| 9 | Sign-in | Forced password change is page-only; office-made parent logins and auto-made staff and student logins are never forced to change | First passwords may stay in use | Open |
| 10 | Access | HR can give anyone, including themselves, any role except admin | Logged, but not blocked | Open |
| 11 | Reports | Report checkers see and edit every comment in the period, not only their scope | Wider access than set | Open |
| 12 | Reports | The Publish switch on /reports/periods is not used anywhere | No effect | Open |
| 13 | Other Half | A retired activity stays on the timetables of students who chose it | Stale timetables | Open |
| 14 | Other Half | An activity with past registers but no current choices can be deleted | Past marks lose their activity name | Open |
| 15 | Other Half | Changing year groups or capacity doesn't re-check existing choices | Over-full or ineligible activities | Open |
| 16 | Other Half | Printed timetables leave out OH choices | Incomplete printouts | Open |
| 17 | Other Half | Nobody holds the other\_half coordinator role | Only SMT and admins can manage OH | Open |
| 18 | Tuckshop | tuckshop\_owner can open pages whose actions only tuckshop, bursar and admin may perform | Harmless today (owner is admin) | Open |
| 19 | Tuckshop | A top-up adds an invoice charge with no matching payment | Parent's invoice shows unpaid | Open |
| 20 | Tuckshop | Top-ups by a tuckshop-only user may be refused by the fee-charging step | Needs testing | Open |
| 21 | Registers | Registers Not Done checks term dates only, not holidays inside a term; one mark for any student clears a class | False or missed alerts | Open |
| 22 | Leavers | A leaving date that passes without anyone saving the record leaves the student active | Login stays on | Open |
| 23 | Next year | Importing next year's Nova-T file on the normal import page, not in plan mode, would overwrite this year's timetable; nothing in the database stops it | Live timetable replaced | Open |
| 24 | Next year | The mentor structure's "confirmed" lock, and the warnings about years or groups with no mentor, are page-only | Plan can change after confirmation | Open |
| 25 | Admissions | No admission form fee is set for any year | Bursar can't record form payments yet | Open |
| 26 | Admissions | The deposit amount recorded isn't checked against the year's deposit | A wrong amount can be recorded | Open |
| 27 | Fees | No year-group prices have been approved for locked items yet | Locked items can only be charged at an approved single price, if one exists | Open |
| 28 | Registers | Missed Lessons for an earlier day names the lesson from today's classes and timetable | After a class change the wrong class can be shown; the marks themselves are right | Open |
| 29 | Fees | Record a Payment, All Students (/bursar/fees-table) and Add Paid Top-Up are written with styling classes the app never loads | The pages work but show as plain, unstyled text and form fields; found while taking screenshots for the User Manual | Open |
| 30 | Registers | Planned absences skip only days marked as a holiday on the calendar. Mid-term breaks are a single date there (24 Oct, 13 Feb, 22 May), so an absence spanning one filled in the break days too. Fixed for 2026/27 on 2 Oct 2026: every weekday of the three breaks (26–30 Oct, 15–19 Feb, 24–28 May) is now a holiday on the calendar; later years' breaks need the same | Extra absence marks on days the school was closed | Fixed |
| 31 | Parents | Some families have two or more parent records with the same email (from separate imports). A parent login is tied to one record, so a child linked only to the other record doesn't appear in the portal. Found 2 Oct 2026 when a parent saw "No linked children"; the 7 logins affected then were fixed by hand (one Francis IYIOKU link left off until the office confirms his guardian). Since 4 Oct 2026 the office is warned when it adds a parent whose email is already on record, and offered the existing parent instead (FR-2.19); the warning is page-only and existing duplicates aren't merged. Marked fixed 4 Oct 2026 (the principal): no login is missing a child except Francis IYIOKU, whose guardian link the SRO is confirming with the family | A parent sees some or none of their children | Fixed |
| 32 | Students | Any admin login could still add a student. Migration 275 left the office's rule as the only way in, but that rule's role check lets every admin through. Found 2 Oct 2026 by the Permissions page's new "What they can do" view. Migration 328 makes the rule check the school\_office role alone; run in the SQL editor on 2 Oct 2026, and admin alone can no longer add a student | FR-2.18 not enforced: admin alone can add students | Fixed |
| 33 | Behaviour | Migration 319 (only SMT remove a merit or cancel a detention; events can't be withdrawn or moved from the app) was written on 2 Oct 2026 but never reached the live database. Found 3 Oct 2026 while preparing stage 2 of the tickable abilities; applied by migration 330 the same day. Every other migration since 300 was checked and is live | Until 3 Oct any admin could delete events, and anyone with Detention could cancel or re-date a detention | Fixed |
| 34 | Behaviour | A reviewer's "return to teacher" note (FR-6.27) is stored on the event. The portals never show it, but a student can read their own events' data directly, so a technically minded student could read the note. It is cleared when the teacher edits the event, but stays if the reviewer sends the event to parents unchanged | Reviewers should keep notes factual (e.g. "this is Disruption in class, −2") | Open |
| 35 | Results | A mark appeal (FR-7.27) waits until the student's teacher decides. Nobody else can decide it if the teacher is away or has left, and it holds one of the student's credits meanwhile | An appeal can wait with no end; no deadline or hand-over to the Head of Department yet | Open |
| 36 | Behaviour | Two mentors on the timetable don't hold the mentor role (found 4 Oct 2026): Uche Isiani (UIS, 10C/Me) and Christopher Agunwa (CSA, 10D/Me), who are teachers only. Behaviour Totals (FR-6.29), Certificates and other pages granted to mentor are missing for them | They can't see their group's behaviour totals; both were given the mentor role on 4 Oct 2026, and every mentor group's mentor now holds it | Fixed |

Choose "Decided: keep" for anything the school is happy to leave as it is.

## 25. Glossary

| Term | Meaning |
| --- | --- |
| Active student | A student whose status is active; leavers and others are excluded from classes, messages, charges and choices |
| Block | A curriculum block from Nova-T; a student takes one class per ordinary block |
| CAT4 / NGRT | Cognitive Abilities Test and New Group Reading Test scores, imported from CoreSats |
| Change History | The permanent log of sensitive changes (registers, fees, behaviour, access, parent links, email) |
| EP | Evening Prep, 19:00–21:00 Sunday to Friday; the only time students can choose OH |
| Grade History | The permanent log of every score, target and transcript-grade change |
| KS3 / KS4 / KS5 | Key stages: Years 7–9, 10–11 and 12 |
| Lagos time | West Africa Time (UTC+1); every date and cut-off in Formwork uses it |
| Mentor group | A form group; its mentor writes the mentor report comment |
| Nova-T | The timetabling software the timetable is imported from |
| OH | The Other Half, the after-lessons activity programme |
| Report period | A reporting round with year groups and due dates for comments and checking |
| Restaurant | The dining group a student eats in; tuckshop orders are sorted and handed out by restaurant |
| Result set | A calendar event marked as a result set; scores are entered against it |
| RLS | Row-level security: database rules deciding which rows each person can read or change |
| SRO | The school office (sro@abc.sch.ng) |
| UPN | Unique Pupil Number, the student ID used to match imports |
| Voided event | A behaviour event withdrawn on an upheld appeal; points 0, original kept |
| WAEC / IGCSE | The two grading scales: WAEC (A1–F9) for Year 12, IGCSE (A\*–U) for Years 7–11 |
