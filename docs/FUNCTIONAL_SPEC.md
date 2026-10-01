<!-- Snapshot of the living doc "Formwork — Functional Specification": https://claude.ai/code/artifact/659cca3b-399b-425f-bb5f-8b23577d5714
     The living doc is the master; edit it there, not here. This file is re-exported
     whenever the doc is updated (see .claude/skills/update-docs/SKILL.md). -->

# Formwork — Functional Specification

Sep 29, 2026 · @Chris TERRY

## 1. Purpose and scope

This specification describes what Formwork does as built on 1 October 2026 (database migrations up to 299). It is written from the live system and its code, not from a plan, so it is a record of current behaviour, not a wish list.

**Formwork** is the school management information system (MIS) for Adorable British College, a boarding and day secondary school of about 260 students in Years 7–12. It is used by staff, students and parents at misform.work.

**Audience:** the principal, SMT, anyone taking over development, and auditors.

**How requirements are written.** Each module has numbered requirements (FR-4.3 = module 4, requirement 3). Each is labelled with how it is enforced:

- **\[DB\]** — enforced by the database. It holds however someone reaches the data, including an edited browser request.
- **\[Page\]** — enforced only by the web page. It guides normal use but is not a security boundary.

Where behaviour differs from what a page suggests, it is listed in section 23, Known issues. Nothing in that section has been fixed yet.

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
| Backups | Nightly dump to private storage, plus Supabase's own daily backups | See section 22. |

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
| admin | 3 accounts (an account setting, not a staff role) | Passes nearly every check. Sets permissions, bell times, imports, backups. Cannot unlock the tuckshop hand-out list or use Hand Out. |
| smt | Senior leaders | Calendar and terms, behaviour picture review, Change History, Grade History, email reply routes, publishing fees, sending messages, OH management. |
| hr | HR | Staff HR records, register alerts, staff roles (any except admin). |
| pastoral | Pastoral staff | Appeals, detentions, editing behaviour events, class allocation, sending messages. |
| houseparent | Boarding houseparents | Their house's students by default; appeals, detentions, pastoral comments. |
| head\_of\_boarding | Head of boarding | Houseparent powers across all houses; counts as pastoral. |
| teacher | Teaching staff | Registers, results for their own classes, behaviour logging, subject comments. |
| mentor | Form tutors | Their mentor group; mentor comments. |
| head\_of\_department | HoDs | Class Progress for their department; deleting their department's scores; class allocation. |
| assessment\_manager | Data lead | Any result, target, CAT4/NGRT; transcript grades; Grade History; publishing documents. |
| assessment\_user | Data assistants | Enter any result or target, but not delete. |
| bursar | Bursar | Fees, invoices, payments, discounts; tuckshop admin (not Hand Out). |
| school\_office | Office / SRO | Student records (all fields), parent records and logins, parent welcome letters, register alerts, releasing −5 behaviour to parents, messages. |
| admissions | Admissions | Admissions pages and student entry. |
| tuckshop | Tuckshop staff | Tuckshop pages only, including Hand Out. |
| tuckshop\_owner | cs@ (Uju MBA) | As tuckshop, plus the only role that can unlock a saved hand-out list. |
| nurse | School nurse | The only role (with admin) that can see clinic and medical records. |
| other\_half | OH coordinator | Manages OH activities and choices. Nobody holds it at present. |

Two further roles exist only to approve fee prices (FR-10.10): **principal** (principal@) and **college\_secretary** (cs@). Being an admin doesn't count as either.

**Students** see their own timetable, grades, behaviour (and appeal), tuckshop ordering, OH choices and documents. **Parents** see each linked child's timetable, results, released behaviour, attendance, published fees, tuckshop balance and documents.

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

**Server routes**

- **FR-1.10** Every server route except the parents' calendar feed (FR-1.11) checks the caller's sign-in and page access before doing anything, and the build fails if one doesn't. Backup is admin-only whatever the permissions page says. \[DB + build check\]
- **FR-1.11** One route works without sign-in: the parents' calendar feed (/api/calendar-feed/…), because calendar apps can't sign in. Each parent's secret link is the check instead, and the build check lists this route as its only exception. It returns only the events parents see on their calendar page, and nothing once none of the parent's children is still at the school. Agreed by the principal, 30 Sept 2026 (migration 274). \[DB + build check\]

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

**Student documents**

- **FR-2.11** Documents (reports, transcripts, score sheets) are stored one per student, per type, per term; a new copy replaces the old. Admins, SMT and assessment managers publish or delete them, and can bulk-upload PDFs matched to students by file name. \[DB\]

**Portals**

| What | Student portal | Parent portal (per child) |
| --- | --- | --- |
| Timetable, with Other Half activity | Yes | Yes |
| Grades against targets | Yes | Yes |
| Behaviour | Own events (not voided); can appeal negatives | Only events released to parents |
| Attendance | No | Yes, including today lesson by lesson |
| CAT4 / NGRT scores | No | Yes |
| Fees | No | Only for terms SMT has published |
| Tuckshop | Order, see balance and purchases | See balance and purchases; cannot order |
| Other Half | Choose activities during Evening Prep | See the chosen activity |
| Published documents | Own | Each child's |
| Homework (Years 10 and 11) | Own classes' homework, files and links; own grade once released; this school year | No |
| Inbox | Yes | Yes |

- **FR-2.12** Each portal shows only the signed-in student's own data, or the parent's linked children's. \[DB\]

* **FR-2.13** A parent sees a child only while that child is an active student. When a child leaves, their records drop out of the parent portal, though the parent link is kept. Staff who are also parents still see leavers through their staff access. \[DB\]

**Families and siblings**

- **FR-2.14** A parent's relationship (Mother, Father, Other and so on) is recorded for each child they are linked to, not once per parent. The parent's own value is used only where a link has none. \[DB\]
- **FR-2.15** A student's profile has a Siblings card, for staff only, listing brothers and sisters found through shared parents: current students first, then leavers with their leaving date. Only name, year and form are shown, never parent details. \[DB\]
- **FR-2.16** Two children are siblings through a parent only when neither child's link to that parent is "Other". The principal's and college secretary's links to students they follow through the parent portal are "Other" (cs@ is Mother only for her own children), so they never make unrelated children siblings. \[DB\]

**Gender**

- **FR-2.17** Every student's gender is required and is Male or Female, chosen from a list on the New Student page and the student record. It can't be blanked by an edit or a CSV re-import; the import converts Male/Female and refuses a new student without one. \[DB\]
- **FR-2.18** Only the school office can add a new student, at /students/new or /students/import; holding admin is not enough. Admins can still see, correct and delete student records. Someone who holds both admin and school\_office adds students through their office role, so to stop a person adding students, remove their school\_office role (migration 275). \[DB\]

## 6. FR-3 Timetable, classes and Nova-T imports

The timetable comes from Nova-T and is imported by admins; Formwork never invents classes or subjects.

**Structure**

- **FR-3.1** The school day has 9 sessions: Registration (M), Lessons 1–6, The Other Half (OH) and Evening Prep (EP). Each weekday has its own bell times, set by admins at /admin/bell-times. \[DB\]
- **FR-3.2** Saving a bell time moves every lesson in that period to the new time. A session can't be removed from a day while lessons are timetabled in it. Registers are tied to the period, not the time. \[DB\]
- **FR-3.3** A class belongs to a curriculum block. In an ordinary block a student can be in only one class; compound blocks (Pathway, Vocational) allocate a whole group of subjects together. \[DB\]
- **FR-3.4** A single lesson can have its own teacher or room, different from its class. Timetables, printed timetables, Registers Not Done and alerts all use the lesson's own first. \[DB\]
- **FR-3.5** Staff commitments (meetings, part-time non-working periods) block only that person's own slot and have no register. \[DB\]

**Who changes what**

- **FR-3.6** Only admins change classes, lessons, staff commitments and bell times. Admins, Heads of Department and pastoral staff move students between classes, at /admin/block-allocation. \[DB\]

**Nova-T timetable import (/admin/import-classes, admin only)**

- **FR-3.7** A lesson's subject comes only from the subject code in the group name, with the set number removed (10LI/El → El = Literature). Subject codes are maintained in SQL, never guessed. \[Page\]
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

- **FR-4.1** Any member of staff can mark any register, for any class or activity. This is the school's decision (27 Sept 2026). \[DB\]
- **FR-4.2** One mark per student, per date, per period: present, late, absent or authorised absence. Saving again overwrites. \[DB\]
- **FR-4.3** No register can be saved for a future date (Lagos time). Past dates are allowed after a confirmation. \[DB / Page\]
- **FR-4.4** A late mark needs the minutes late (0–600). While the lesson is running, the box suggests the minutes since it started. \[DB range; Page requires it\]
- **FR-4.5** Beside each student, the register shows their other marks today as coloured badges (M, L1–L6, OH, EP), and for subject classes their last grade. The last grades are hidden until the teacher presses "Show last grades", so they are not on the class's screen by default. \[Page\]
- **FR-4.6** Changes and deletions of marks are logged permanently in Change History; taking a register is not. \[DB\]
- **FR-4.7** Parents can read their own children's attendance; students cannot read attendance. \[DB\]

**Registers Not Done (/pastoral/registers-not-done)**

- **FR-4.8** A lesson is listed when it is timetabled today inside term dates, more than 15 minutes past its start, has at least one enrolled student, and none of them has a mark for that period. It stays listed for the rest of the day. \[DB\]
- **FR-4.9** The row goes to the lesson's own teacher where Nova-T gives it one, otherwise to the class teacher. OH activities are listed the same way (FR-5.12). \[DB\]
- **FR-4.10** Open to pastoral, houseparent, SMT and admin. Each teacher also sees a banner of their own overdue registers on their timetable. \[Page\]

**Register alerts (/admin/register-alerts)**

- **FR-4.11** Every 15 minutes, outstanding registers are copied into a permanent alert list, once per lesson per day (once per activity per staff member for OH). An alert stays even if the register is taken later, until someone marks it resolved. \[DB\]
- **FR-4.12** HR, the school office and admins see and resolve alerts. Nobody can create or delete them from the app. \[DB\]

**Attendance summary**

- **FR-4.13** For each student: today, this week and this academic year — sessions, present, late, authorised absent, absent, and total minutes late. The year starts at the first term beginning on or after 1 August. \[DB\]

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

- **FR-5.7** A student can choose, change or clear a choice only when all of these hold: it is Evening Prep now (the EP bell time for today, currently 19:00–21:00 Mon–Fri); choices are open for the term and the closing time hasn't passed; the activity is active; the student is active and in one of its year groups; and the activity isn't full. \[DB\]
- **FR-5.8** One choice per student per weekday per term; choosing again replaces it. Two students can't both take the last place. \[DB\]
- **FR-5.9** Staff with OH management can place, move or remove any student's choice at any time at /other-half/choices, and can go over capacity or outside the year groups after an "anyway?" warning. \[DB / Page warning\]

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
- **FR-6.7** Only admins can delete an event. Changes and deletions are logged in Change History. \[DB\]

**Release to parents (/behaviour/review)**

- **FR-6.8** Positive events are always visible to parents. Negative events are hidden until reviewed. \[DB\]
- **FR-6.9** Events with a picture: SMT or admin send the text with the picture, the text alone, or decline. −5 events without a picture: the school office or admin release the text. −1 to −4 events without a picture never go to parents. SMT get an inbox notice for each picture to check. \[DB\]

**Alerts**

- **FR-6.10** When a negative event is logged and it is −5, or the student's negative total for the Saturday–Friday week reaches −8, an alert email goes to cs@, copied to every SMT member and sro@. Replies go to guardian.counselling@. \[DB\]

**Appeals**

- **FR-6.11** A student can appeal their own negative event, once per event; the appeal always starts as pending. Parents can't appeal. \[DB\]
- **FR-6.12** Pastoral, houseparent, head of boarding, SMT and admin decide appeals; any staff can read decided ones. \[DB\]
- **FR-6.13** An upheld appeal voids the event (points to 0, original kept), hides it from the portals, cancels its detention and, if the week no longer reaches −10, the weekly detention, and tells the student. \[DB\]

**Detentions (/detention)**

- **FR-6.14** A detention is booked automatically for the Friday of the Saturday–Friday week when a −5 event is logged, or when the week's negative total reaches −10 (positive points don't offset). Staff can't add or delete detentions by hand. \[DB\]
- **FR-6.15** Detentions are in CG4 after lesson 7. Statuses are scheduled, attended, missed and cancelled; whoever has the /detention page updates them. \[DB\]
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

## 10. FR-7 Assessment, results and targets

Teachers enter percentage scores for their own classes against result sets; each score is graded from the subject's boundaries and compared with the student's target.

**Result sets**

- **FR-7.1** A result set is a calendar event with the "result set" box ticked; SMT and admins manage the calendar. Only the current school year's sets can be picked for entry. \[DB / Page\]
- **FR-7.2** End-of-term exams are one result set per year group per term, back to 2017; Year 12 has Terms 1 and 2 only (Term 3 is WAEC). They are found by year group and term, never by name. \[DB\]

**Entering and deleting scores (/results/enter)**

- **FR-7.3** A teacher enters or changes scores only for students in their own classes, in that class's subject. Assessment managers, assessment users and admins can enter any score. \[DB\]
- **FR-7.4** Scores are percentages (0–100). The grade is worked out from the subject's boundaries for that year group when the score is typed, and saved with it; later boundary changes don't regrade saved scores. \[Page\]
- **FR-7.5** One score per student, per subject, per result set. Types: short test, teacher assessment, exam grade (plus imported term exams). \[DB\]
- **FR-7.6** The class teacher, a Head of Department for their department's subjects, and assessment managers and admins can delete a score. Assessment users can't. \[DB\]
- **FR-7.7** Every insert, change and delete of a score, target or transcript grade is logged permanently in Grade History, with old and new grade and who did it. Nobody can edit the log. SMT, assessment managers and admins read it at /assessments/grade-history. \[DB\]

**Boundaries, subjects and targets**

- **FR-7.8** Grade boundaries are set per subject and per year group (7–12). Any member of staff can edit boundaries, subject aliases and key-stage tags (school decision, 27 Sept 2026). \[DB\]
- **FR-7.9** One target grade per student per subject, on the IGCSE (A\*–U) or WAEC scale. Assessment managers and admins set and delete targets; assessment users set but can't delete. \[DB\]
- **FR-7.10** A subject with no target of its own borrows one from a related subject (e.g. Further Maths from Maths). Portals show targets only for subjects the student takes. /target-grades/coverage lists students missing a target. \[DB / Page\]
- **FR-7.11** Grades are compared with targets as above, on or below (green, amber, red). No comparison is made across IGCSE and WAEC. \[Page\]
- **FR-7.12** CAT4 and NGRT scores are imported from CoreSats by UPN; only assessment managers and admins can change them. Staff and parents can read them; students can't. \[DB\]

**Analysis pages**

- **FR-7.13** Missing Grades lists, class by class, who has no mark in a set. A subject is expected only if someone in that year group has a mark for it. \[DB\]
- **FR-7.14** Top 10 ranks students in a result set by average percentage, per year or overall, sharing tied ranks. \[Page\]
- **FR-7.15** Review Results (subject overview) charts a student's or class's scores across result sets. Class Progress shows a class against targets. \[Page\]

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

**Hand-out (/tuckshop/hand-out)**

- **FR-9.11** Open to the tuckshop and tuckshop\_owner roles only; admins and the bursar can't use it. \[DB\]
- **FR-9.12** Tapping a student marks the order given and charges it; tapping again undoes it and refunds exactly. Staff can record fewer items than ordered when stock ran out, and the student pays only for what they got. \[DB\]
- **FR-9.13** Save and lock freezes a restaurant's list for the day, recording the numbers, value, who and when. Only tuckshop\_owner can unlock; being admin is not enough. Every save and unlock is kept. \[DB\]
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

**Pages**

| Page | What it does |
| --- | --- |
| /bursar/charge-checklist | Pick a term and fee item, select students, charge them in one batch; shows who already has it |
| /bursar/fee-items | Add or edit fee items: name, category, optional or not, default amount (₦) |
| /bursar/discounts | Define discount types, assign and apply them |
| /bursar/payments | Find a student and term, see invoice lines and payments, record a payment (amount, method, reference, date), download the invoice PDF |
| /bursar/fees-table | Charged, paid and balance for every active student this term |
| /bursar/debtors | Students owing for a term, with parent phone and email; CSV export |
| /bursar/audit | The last 100 charge batches and who made them; undo a batch |
| /smt/fees-dashboard | Collection totals by year group and fee item; the Publish to parents / Hide switch (SMT and admin) |

## 14. FR-11 Pastoral, boarding, clinic and HR

Medical records are visible only to the nurse and admins; HR records only to HR and SMT; boarding views default to the houseparent's own house.

**Boarding and pastoral**

- **FR-11.1** Houseparents' student and behaviour pages default to their own house. Those with other school-wide jobs get a "Whole school" switch. This is a display filter; all staff can read every student. \[Page\]
- **FR-11.2** The head of boarding has houseparent powers across all houses and counts as pastoral for detentions, appeals and editing events. \[DB\]
- **FR-11.3** A mentor's students are the students in their mentor-group class. \[DB\]
- **FR-11.4** /pastoral/birthdays shows the next 7 days of birthdays (up to 31) to admin, SMT, pastoral, houseparent and school office. Today's names are shown to staff and students after sign-in, never to parents. Leavers are excluded. \[Page\]

**Clinic**

- **FR-11.5** The clinic holds each student's medical profile and consents, conditions, growth and BMI, sick-bay visits, immunisations, and termly resumption screenings (one per student per term per type). \[DB\]
- **FR-11.6** Only the nurse role and admins can see or change any of it. Teachers, pastoral staff, houseparents and parents have no access. \[DB\]

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
| Anything else | sro@ |

- **FR-12.7** One admin switch pauses every email to parents; inbox copies are still delivered. It is currently off (emails are sent). \[DB\]

## 16. FR-13 Calendar, terms and administration

SMT own the calendar and terms; admins own setup, imports, permissions and backups.

**Calendar (/calendar)**

- **FR-13.1** Staff see the academic calendar of terms and events. SMT and admins add, edit and delete events; each has a date, name, category, optional year-group note and a "result set" flag. \[DB\]
- **FR-13.2** Adding a report-period event also creates the report period, with its year groups and due dates. \[Page\]
- **FR-13.3** SMT add and edit terms; only admins delete a term (it also deletes that term's OH programme). \[DB\]
- **FR-13.4** Parents see a read-only calendar of term dates and events, without staff deadlines. \[Page\]
- **FR-13.7** Parents can subscribe to the school calendar from /parent-portal/calendar (iPhone, Mac and Outlook; Google; or copy the link). Each parent has a private link that their calendar app re-checks every few hours, so moved or cancelled events update on their phone by themselves. A parent can make a new link, which stops the old one working. The feed holds events from the current academic year on, without Teacher Assessment weeks or report periods, and goes empty once none of their children is still at the school. The one-off download buttons remain, labelled as copies that won't update. Staff don't see the subscribe card, including in View as Parent. (Migration 274.) \[DB\]

**Home dashboard**

- **FR-13.5** Staff see a top row of big tiles (My Timetable, Calendar and, for staff who are also parents, My Children), a second row (Log behaviour, Inbox with its unread count), and module cards underneath. Three cards carry a number beside their icon that links to its page: active students on Students, staff on Staff & Access, behaviour alerts in the last 7 days on Pastoral, each shown only to those who can open that page (migrations 292–294). Each card shows only the pages the person's roles can open, and each page is on one card only: Detentions, Certificates and Behaviour Appeals are on Pastoral, Class Allocation on Timetable. Students see big tiles (Timetable, Homework for students in a class with homework switched on, The Other Half, Assessment, Behaviour, Tuckshop, Messages); parents go straight to their portal; a bursar sees Fees and Tuckshop only. \[Page\]
- **FR-13.8** The order of the big tiles on students' home page and of every row of the staff dashboard (the top row, the second row and the module cards, which the bursar's home page also uses) is set once for the whole school at /admin/tile-order (admins). Tiles not yet placed go after the ordered ones. The order never changes which tiles someone sees; page access and which classes have homework switched on still decide that. \[DB\]

**Administration pages**

| Page | What it does | Who |
| --- | --- | --- |
| /admin/permissions | Tick which pages each role opens and which student fields it can edit | Admin (write) |
| /staff/roles | Assign staff roles; warns when a houseparent has no house | HR, admin |
| /staff/mentor-groups | Assign one or two staff to each mentor group | Granted roles |
| /admin/lookups | Boarding houses, sports houses, behaviour categories and points, behaviour thresholds, detention room and time, certificate levels, academic years, admission fee proposals | Admin, SMT, HR |
| /admin/student-numbers | Boys, girls and unknown by year, mentor group and class | Granted roles |
| /admin/class-lists | Print class rosters by year, subject or class | HR, school office, admin |
| /admin/bell-times | Sessions and times for each weekday | Admin |
| /admin/subject-settings | Subject display names, departments, key stages, aliases, target fallback | Assessment manager, admin |
| /admin/grade-boundaries | Grade cut-offs per subject and year group | Assessment manager, admin (page); all staff (data) |
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

**Designed, not built yet:** enrolling an accepted applicant as a student (admission number, UPN, login, parent records, CAT4), removing old applicants' personal data, and showing interests to the Other Half coordinator.

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

**What can be seen, where, and by whom**

| Record | What it keeps | Where to see it | Who can see it | Working today |
| --- | --- | --- | --- | --- |
| Change History | Registers (changes and deletions), fees and prices, fee approvals, academic years, behaviour events, thresholds and certificate levels, roles, permissions and logins, parent links, email settings, admissions, student groups (the group, its students and its staff), student records (every student added, changed or deleted; the photo is noted as changed but not copied) | /admin/change-history: filter by dates, area, student, person and action; latest 500; CSV download | SMT, admin | Yes |
| Grade History | Every score, target, transcript grade, homework grade and student group mark entered, changed or deleted, with old and new grade. Homework grades and group marks are hidden unless chosen, and only SMT and admins can read them | /assessments/grade-history: filter by dates, student, person, grade and action; flags where the person signed in differs from the teacher on the record; latest 500; CSV download | SMT, assessment managers, admin | Yes |
| Fee price proposals | Each proposal, who made it, both approvals or the reason for rejecting | /bursar/fee-approvals | Bursar, SMT, principal, college secretary | Yes |
| Charge batches | The last 100 group charges and who made them | /bursar/audit, with undo | Bursar | Yes |
| Admission letters | Every letter produced, as sent, who sent it and the email address | Each applicant's page | Admissions, SMT, admin | Yes |
| Sent messages and emails | Every message and automatic email, recipients and delivery status (never the body) | /comms/history | SMT, pastoral, school office, admin | Yes |
| Tuckshop hand-out locks | Every save and unlock, numbers given and value | /tuckshop/hand-out | Tuckshop, tuckshop owner | Yes |
| Register alerts | Every register not taken 15 minutes after the start | /admin/register-alerts | HR, school office, admin | Yes |
| Behaviour event edits | Old and new comment and category for every edit | No screen yet | Database only | Recorded, not viewable |

**What is not recorded**

- **FR-16.5** Taking a register for the first time (only later changes are logged). \[DB\]
- **FR-16.6** Changes to grade boundaries, subject aliases and key stages. \[DB\]
- **FR-16.7** Who looked at or downloaded a record: Formwork logs changes, not viewing. \[DB\]
- **FR-16.8** Anything before the September 2026 import from SIMS, including class and subject-choice changes. \[Data\]
- **FR-16.9** Who added a student, and changes to student records, before 30 September 2026 (logged from migration 286). \[Data\]
- **FR-16.10** A student ticking homework done or unticking it. The tick keeps its own time, but unticking leaves no trace. \[DB\]

## 20. FR-17 Homework

Teachers set homework for a class with a deadline and a grading system, and record a grade for each student. The grades inform the end-of-term written report (FR-17.12) but never transcripts, result sets or target grades. It began as a pilot on 10\_1/Ma and 11\_1/Ma and has been open to every Year 10 and 11 teaching group since 30 September 2026 (migration 295). The design and the principal's decisions are in docs/homework-design.md.

**Which classes, and access**

- **FR-17.1** Homework can be set only for classes an admin has switched on. Switching a class off stops new homework but keeps everything already set and marked. Every Year 10 and 11 class is switched on except mentor groups and Prep (supervised study, not a taught subject); a new Year 10 or 11 class, from a later timetable import or next year's timetable, is switched on automatically unless it is a mentor group or Prep (migration 296). An admin can still switch a class off, and a re-import doesn't switch it back on. \[DB\]
- **FR-17.2** /homework is granted to teachers, Heads of Department and SMT (and admins). The page shows the person's own classes (those they teach, or teach a lesson of) as buttons. A drop-down holds the other switched-on classes in the subjects they teach, marked view only (what was set, with instructions and files, but no grades and no editing), plus any class they manage as Head of Department or admin; a Year 7–9 teacher sees that it isn't switched on for their classes yet. \[DB\]

**Setting homework**

- **FR-17.3** Homework is set from the class register (/attendance, a Homework panel for classes the teacher can set it for) or from /homework. Each piece has a title of at most 10 characters (so it fits the mark sheet; the database refuses a longer title on new homework or a changed title, migration 290), plain-text instructions, a deadline date, optionally the lesson it is due in (one of the class's lessons that day), and a grading system. \[Page\]
- **FR-17.4** Setting, editing and marking are open to the class teacher, the teacher of any single lesson of the class, the Head of Department for the subject, and admins. \[DB\]
- **FR-17.5** The subject, class code, year group and academic year are copied from the class, never taken from the page, so homework survives the class being removed at the year switch. \[DB\]
- **FR-17.6** Once any grade is recorded, the grading system can't be changed and the homework can't be deleted, only withdrawn. \[DB\]
- **FR-17.7** The teacher can attach files (PDF, Word, PowerPoint, Excel, OpenDocument, images, text or CSV, up to 20 MB each) and https:// links. The same people who can set the homework add or remove them. Files are private and open through a link that lasts ten minutes. \[DB\]

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

- **FR-17.10** Students see homework on their weekly timetable, on the lesson it is due in, with a week selector, and on a Homework page laid out by day, with overdue and recently graded lists. \[Page\]
- **FR-17.11** Every homework grade entered, changed or deleted is logged permanently in Grade History, like any other grade. Only SMT and admins can read those entries, and /assessments/grade-history hides them unless "including homework" is chosen. \[DB\]
- **FR-17.12** Homework feeds the end-of-term written report only (migration 291). For each student and subject, the database works out the average of the term's number-marked homework from any class, its grade from the subject's boundaries, and how many were marked and not handed in. Every mark for homework due that term counts, released or not; Not handed in is counted separately, not as zero. The report writer shows these figures and pre-fills the Homework judgement from the average (80%+ Excellent, 60–79 Good, 40–59 Satisfactory, under 40 Needs Improvement), which the teacher can change; the period's assigned checkers see them too. The printed report's Homework line shows the grade only (e.g. B), never the percentage; a subject with no homework marks shows the teacher's judgement. Transcripts, result sets and target grades never use homework. \[DB / Page\]
- **FR-17.13** A student can tick their own homework as done, and untick it, until a grade is released. It is the student's own note, not a hand-in or a grade. They can tick only homework set for their class, and the time is recorded by the database. The class's teachers, the Head of Department, SMT and admins see how many students ticked each homework on the homework list and the register's Homework panel, and each student's tick in the mark book; classmates, other staff and parents don't. \[DB\]
- **FR-17.14** On the student's Homework page and timetable, colour shows where each piece stands: red for overdue or not handed in, amber for due today, green for ticked done, purple for graded, blue for due later. A ticked card shrinks to just the subject. Ticked homework no longer counts as due this week or overdue. \[Page\]
- **FR-17.15** Each class on /homework has a mark sheet: one row per student and one column per homework due between two dates (the current term by default), each column headed by the title and due date. It shows each student's average of their number-marked homework with its grade from the subject's boundaries, how many were marked and how many weren't handed in, and downloads as CSV. It shows only what the person may already see. \[Page\]
- **FR-17.16** Marks follow the student. If a student changes class or teacher, whoever teaches them in that subject now can read all their homework marks in it for the current school year, from any class. The teacher who gave the marks, the Head of Department, SMT and admins still see them, and the student still sees their own released marks. (Migration 291.) \[DB\]
- **FR-17.17** Student view: on /homework, staff can open any class shown there in "Student view", which draws that class's week of homework exactly as its students see it on their Homework page (week picker, coloured cards, detail panel with instructions and files), as a student who hasn't ticked anything or been graded. No student's ticks or grades are shown and nothing can be changed. \[Page\]
- **FR-17.18** Late joiners: Formwork records the day each student joins a class. Homework due before that day isn't shown to the student, and they are left out of its mark book, the list's marked count and the mark sheet (shown as ·), unless they already have a mark for it. Students already in a class on 1 October 2026 count as joining on 1 September 2026. (Migration 298.) \[DB / Page\]

**Not built yet:** students handing work in online (the principal's answer was "not yet"), and notifications: setting homework or releasing marks sends no email or inbox message.

## 21. FR-18 Student groups

SMT, pastoral staff and the school office make groups of students for activities, clubs, the prefects, interventions and messages, and can have the system build a group from a rule. Built 30 September 2026 (migrations 284–285 and 287); the design and the principal's decisions are in docs/student-groups-design.md.

**Groups and members**

- **FR-18.1** Only SMT, pastoral, the school office and admins can create a group, change its name, kind or visibility, archive it, or add and remove its students and the staff who run it. Teachers can open /groups and look groups up. \[DB\]
- **FR-18.2** All staff can see every group and who is in it. Students and parents see nothing about groups yet. \[DB\]
- **FR-18.3** Only current students can be added. A student who leaves stays listed, marked as left, and stops getting the group's messages. \[DB\]
- **FR-18.4** A group is archived, never deleted. An archived group can't be messaged or have students added. \[DB\]
- **FR-18.5** Students are added by name (the list of matching names as you type) or a whole year or form at once. Each group names the staff who run it; they can't change who is in it. \[Page\]
- **FR-18.6** A group records who can see it: staff only, the students in it, or the students and their parents. The portals don't show groups yet (stage 4). \[Page\]
- **FR-18.7** A student's profile has a Groups tile listing the groups they are in. \[Page\]

**Groups built from a rule**

- **FR-18.8** At /groups/build the person building chooses a rule and every setting each time (the principal: build settings must be editable). Negative behaviour: negative points between two chosen dates at or below a chosen threshold, withdrawn events not counted. Below target: latest grade below target in at least a chosen number of subjects, counting only results from a chosen date, compared by grade points and WAEC only against WAEC. Both can be narrowed by year, form and boarding house. \[DB\]
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

**Not built yet:** showing groups on the student and parent portals (stage 4).

## 22. Non-functional requirements

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

## 23. Known issues and open decisions

27 places where Formwork does not behave as its pages suggest, or where a rule is weaker than it looks; none is fixed yet. The first five stop something working today.

| # | Area | Issue | Effect | Status |
| --- | --- | --- | --- | --- |
| 1 | Results | Gradebook import and the quick-add form on /results send a result type ("Exam"/"ReLP") the database no longer accepts | They can't save; /results/enter is unaffected | Open |
| 2 | Certificates | Levels now come from Lookups (Bronze 100, Silver 200, Gold 500), which fixed the old 200-point mismatch. Totals may still read only the first 1,000 events | Totals may be low for some students; needs checking | Open |
| 3 | Subject settings | Assessment managers can open the page but only admins can save names, departments and target fallbacks | Saves by others change nothing, silently | Open |
| 4 | Results | Decimal scores such as 89.5 can fall between whole-number grade bands | Saved with no grade | Open |
| 5 | Behaviour | /behaviour/review page isn't granted to the school office, who release serious events without pictures | Office can't reach its review task | Open |
| 6 | Behaviour | Any staff member can change an event's parent visibility with a direct request | Review can be bypassed | Open |
| 7 | Behaviour | The weekly alert fires again on every further negative event that week | Repeat emails | Open |
| 8 | Behaviour | Deleting an event that already booked a detention probably fails | Admin can't delete it | Open |
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

Choose "Decided: keep" for anything the school is happy to leave as it is.

## 24. Glossary

| Term | Meaning |
| --- | --- |
| Active student | A student whose status is active; leavers and others are excluded from classes, messages, charges and choices |
| Block | A curriculum block from Nova-T; a student takes one class per ordinary block |
| CAT4 / NGRT | Cognitive Abilities Test and New Group Reading Test scores, imported from CoreSats |
| Change History | The permanent log of sensitive changes (registers, fees, behaviour, access, parent links, email) |
| EP | Evening Prep, 19:00–21:00 on weekdays; the only time students can choose OH |
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
