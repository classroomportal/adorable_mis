# Formwork: what the system does, and the rules it enforces

**As of 29 September 2026** (migrations up to 254). Written for school leaders, not developers: it describes what Formwork *does* today, who can do what, and the limits and times it enforces.

Where a rule has changed several times, only the current version is given. Migration numbers are in brackets for anyone who needs to trace a rule back.

**How to read the rules**

- A rule with no label is **enforced by the database**. It holds whichever way someone reaches the data, including by copying and editing a request from the browser.
- **(page only)** means only the web page enforces the rule. It guides normal use but is not a security boundary.
- **Page access vs. data access.** Which tiles and pages a role can *see* is set at `/admin/permissions`. What a person can actually *read or change* is decided separately by the database. Giving a role a page does not give it the data behind the page.
- **School time.** All "today", "now", cut-offs and windows use Lagos time (WAT, UTC+1).
- **Known gaps.** Problems found while writing this document are listed in [§14](#14-known-gaps-and-inconsistencies-found-while-writing-this). None of them has been fixed yet.

---

## Contents

1. [Roles, page access and admins](#1-roles-page-access-and-admins)
2. [Logins and sign-in](#2-logins-and-sign-in)
3. [Students, parents and portals](#3-students-parents-and-portals)
4. [The Other Half](#4-the-other-half)
5. [Registers and attendance](#5-registers-and-attendance)
6. [Timetable, classes and Nova-T imports](#6-timetable-classes-and-nova-t-imports)
7. [Tuckshop](#7-tuckshop)
8. [Behaviour, appeals and detentions](#8-behaviour-appeals-and-detentions)
9. [Assessment, results and reports](#9-assessment-results-and-reports)
10. [Pastoral, boarding, clinic and HR](#10-pastoral-boarding-clinic-and-hr)
11. [Email and messages](#11-email-and-messages)
12. [Fees](#12-fees)
13. [Audit logs, backups and safety](#13-audit-logs-backups-and-safety)
14. [Known gaps and inconsistencies](#14-known-gaps-and-inconsistencies-found-while-writing-this)

---

## 1. Roles, page access and admins

**Staff roles in use:** admin, smt, hr, pastoral, houseparent, head_of_boarding, assessment_manager, assessment_user, teacher, bursar, school_office, admissions, tuckshop, tuckshop_owner, head_of_department, mentor, nurse, other_half.

**Admins**
- "Admin" is a separate account setting, not one of the staff roles. There are 3 admin accounts (175).
- Admins pass almost every check automatically. The exceptions are the tuckshop hand-out list and unlocking it (see [§7](#7-tuckshop)).

**Who can change permissions**
- Only admins can edit page permissions, the per-field student edit grants and departments.
- HR can add or remove any staff role except admin, including roles such as smt or bursar, and including for themselves (112).
- Every role and permission change is logged permanently in Change History.

**Departments and scopes**
- A role can be tied to one department (Science, Maths, Languages, Creative, Humanities) or to one boarding house (051).
- A Head of Department's Class Progress view is filtered to their department **(page only)**.
- A Head of Department's right to delete scores is limited to their department by the database.
- Heads of Department can move any student into any class, not only classes in their department (104).

**Tuckshop roles:** `tuckshop` and `tuckshop_owner` open only the `/tuckshop` pages (231).

**Bursar:** a bursar who isn't an admin sees a home page with only the Fees and Tuckshop tiles.

**Server routes**
- Formwork has four: the backup route, the two AI comment routes, and the parents' calendar feed.
- Each one checks the caller's sign-in and page access before doing anything, except the calendar feed (274). Calendar apps can't sign in, so each parent's secret link is the check instead; the principal agreed this on 30 Sept 2026, and it is the build check's only exception.
- The build fails if a route is missing that check. Backup is admin-only whatever the permissions page says.

---

**Dashboard tile order** (280, 282, 283)
- The order of the big tiles on students' home page and portal, and of the staff dashboard (the top row with My Timetable, Calendar and My Children, row 2 with Log behaviour and Inbox, and the larger tiles underneath, 282–283, 292–294; the numbers of active students, staff and behaviour alerts are shown on the Students, Staff & Access and Pastoral tiles), is set once for everyone at `/admin/tile-order` (Arrange Tiles). Only admins have that page for now.
- The order doesn't change which tiles someone sees. That is still decided by page access (and, for Homework, the pilot). A new tile that hasn't been placed yet goes after the others.

---

## 2. Logins and sign-in

**Staff and students**
- A login is created automatically when a staff record, or a student's school email, is filled in (110). It gets a random 10-character password.
- The welcome email with that password is only sent when an admin saves the record.
- The "never signed in" pages are admin-only (122, 190). They send a normal password-reset link.

**Google sign-in (staff and students)** (221)
- Google sign-in only links to a login Formwork has already made.
- An unknown Google or Gmail account gets no session at all. The login page tells the person they are "not set up in Formwork yet".
- Parents sign in with email and password only.

**Parents**
- Welcome letters are sent by year group from `/parents/welcome-emails`, by admins and the school office, up to 500 per send (172, 299). Each parent gets one letter. Only admins can pause or resume all parent emails.
- The letter sets the first password to the oldest current child's date of birth (`DDMMYYYY`) and forces a change at first sign-in (160).
- A first send skips parents who have already signed in.
- The letter can be sent again to any parent with a login, including parents who have signed in and chosen their own password (237, 276). It resets their password to the date-of-birth one in the letter, and they must choose a new one at their next sign-in.
- If a parent's email has changed and they have never signed in, their login moves to the new address before sending. The send stops if another login already uses that address (244).
- The school office can create a single parent login from the student page (159). It gets a random password, is **not** forced to change it, and is emailed to the parent, or shown once on screen if parent email is paused.

**Forced password change**
- A flagged account is sent to `/change-password` before anything else loads. The new password must be at least 8 characters.
- This is **(page only)**: the database does not block a flagged account.

**Leavers can't sign in** (251)
- When a student's status changes from active, their login is blocked (both password and Google) and they are signed out at once.
- The login is unblocked if they are made active again.
- A leaving date that passes without anyone saving the record does **not** change the status.

**Other rules**
- A student whose email changes before their first sign-in has their login moved to the new address (245).

---

## 3. Students, parents and portals

**Student records**
- All staff can read the whole student record.
- What each role can edit is set field by field (38 fields). A change to a field the editor wasn't granted is refused (151). The school office has all 38.
- Only admins and the school office can change fees fields, ethnicity/FSM fields and family links.
- **Only the school office can add a new student** (`/students/new`, `/students/import`); being an admin is not enough (275). Admins can still see, correct and delete student records. Someone with both roles adds students through their office role.
- Only admins can delete a student.
- Admission number: six digits, issued automatically from the next number in the series. No two students can share one (176).
- Admission date is required. If it's left blank on a new record, it becomes today (194).
- Marking a student as anything other than active removes them from all their classes automatically, whoever makes the change. Their attendance, behaviour and results history is kept (108, 150).
- Photos are stored on the record and shrunk to 400px in the browser.

**Student documents** (095, 253)
- One stored copy per student, per document type, per term. A new copy replaces the old one.
- Only admins, SMT and assessment managers can publish or delete documents.
- Parents see only their own children's documents; students see only their own.

**Parent portal:** for each linked child, parents see:
- timetable, including their Other Half activity
- results against targets
- behaviour released to parents
- attendance, including today lesson by lesson
- fees, but only for terms SMT has published
- tuckshop balance and purchases
- their inbox
- published documents

Parents can also see their children's CAT4/NGRT scores. They cannot order from the tuckshop or make appeals.

**Student portal:** students see:
- their grades against targets
- their behaviour, and can appeal a negative event
- timetable
- tuckshop ordering
- Other Half choices
- published documents

Students **cannot** see their own CAT4/NGRT scores (220) or their attendance.

**View as Parent:** admin, SMT and the school office can see a parent's portal, using only their own access (234).

**Who added a student** (286): every student added through Formwork records who added them and when, and nobody can change that afterwards. Students added before 30 Sept 2026 have no record, except the two Chibuezes (Victory NNAMOKO, 30 Sept, from Supabase's request logs).

**Names are tidied when saved** (286): spaces at the start or end of a name are removed, and double spaces inside a name become one, for students, applicants, parents and staff.

**Student groups** (284, `/groups` under Administration; design in `docs/student-groups-design.md`)
- A group is a list of students for an activity, a club, the prefects, marks or messages. Only **SMT, pastoral, the school office and admins** can create a group, change it, archive it, or add and remove students and the staff who run it. Teachers can open `/groups` and look groups up but not change them.
- All staff can see every group and who is in it.
- **Students and parents** (300) see a Groups tile on their portal, only when there is something to show. A student sees the groups they are in that are marked "Staff and the students in it" or "Staff, the students and their parents"; a parent sees only those marked for parents, and only for children still at the school. They see the group's name, description, kind and who runs it, never who else is in it and never marks. Archived groups, groups from an earlier school year and groups built by the system are never shown.
- Only current students can be added. A student who leaves stays on the list, marked as left, and stops getting the group's messages.
- A group is archived, never deleted. An archived group can't be messaged or have students added.
- **Groups built by the system** (285, 301, `/groups/build`): SMT, pastoral and the school office choose a rule and all its settings each time, see who matches today with the reason, untick anyone, and save the list. The rules are:
  - **Negative behaviour:** negative points between two dates add up to a chosen threshold or worse (e.g. −6). Withdrawn events don't count.
  - **Below target:** the latest grade in a subject, counting only results from a chosen date, is below target in at least a chosen number of subjects. Grades are compared by their points; WAEC grades only against WAEC targets.
  - **Positive behaviour** (301): positive points between two dates add up to a chosen total or more (e.g. +40). Withdrawn events don't count.
  - **Term exam average** (301): a student's average percentage across their subjects in one chosen term exam is below, or at or above, a chosen mark. Marks without a score are skipped. Last year's exams can be chosen; each student is judged on the exam they sat then.
  - **Attendance** (301): present or late as a percentage of every register mark between two dates (the same sum parents see) is below a chosen percentage. Students with fewer marks than a chosen number are left out.
  - All five can be limited to chosen year groups, forms and boarding houses. Only current students are picked.
- A built group records its rule, settings and date, is always staff-only, and never changes by itself. Students can still be added or taken out by hand. "Build again" starts a new dated group from the same settings, which can be changed first. Only students the rule picks can be saved into a built group.
- Every change to a group, its students or its staff is logged in Change History under **groups**.
- **Group marks** (287): a group can have mark sheets (a test or occasion, a date, and a grading system from the homework list). The staff who run the group, SMT, pastoral and the school office record and read the marks; other staff only see that a sheet exists. Students and parents see nothing. A mark must fit the grading system, or be Absent, Not handed in or Excused, and can only be for a student in the group. Once a sheet has marks its grading system can't change and it can only be withdrawn, not deleted. An archived group's marks can't be changed. Group marks are **not part of reporting** and never feed reports, transcripts, result sets or targets. Every change is in Grade History, readable by SMT and admins only (like homework).
- A student's profile has a Groups tile listing the groups they are in.

---

## 4. The Other Half

**OH is run in Formwork, not Nova-T** (156)
- Activities, staff, rooms, year groups and student choices live only in Formwork.
- The Nova-T importer skips any group coded `Oh` or `Sa`, so an import can never change OH. Sports Academy is an OH activity students choose.
- Nova-T's old whole-year OH and Sports Academy groups were deleted (158).

**Who can do what**

| Action | Who |
|---|---|
| Create, edit, retire or delete activities; set room, staff, year groups and capacity | SMT, the `other_half` coordinator role, admins |
| Open or close student choices for a term, and set a closing time | Same |
| Place, move or remove any student's choice, at any time | Same, at `/other-half/choices`. Not limited to Evening Prep |
| Take an OH register | Any member of staff |
| See activities and choice windows | Everyone signed in. Students see their own choices; parents see their children's |

Pages: `/other-half` and its register page are for teaching and pastoral staff. The Activities, Choices and Absentees pages are for SMT, the coordinator and admins. **At present nobody holds the `other_half` coordinator role**, so only SMT and admins can manage OH.

**Activities**
- Each activity runs on one weekday in one term and repeats every week of that term. It needs a name and at least one year group.
- Capacity is a whole number of at least 1, or blank for no limit. Several staff can share an activity.
- A retired activity can't be chosen and drops off staff timetables and Registers Not Done.
- An activity can't be deleted while any student has it chosen.
- A new term can be started as a copy of another term's programme **(page only: offered only when the term is empty)**. The copy includes activities and staff, not choices.
- Only admins can delete a term, because deleting it also deletes that term's OH programme and choices (206).

**How students choose** (at `/portal/other-half`). Every choice or change must pass all of these checks:
1. The account is a student's.
2. **It is Evening Prep right now** (249). The window is the "EP" row in Bell Times for today, currently 19:00–21:00 Monday to Friday. Moving EP in Bell Times moves the window with it.
3. Choices are open for the term, and the closing time (if one is set) hasn't passed.
4. The activity is active.
5. The student is active and in one of the activity's year groups.
6. The activity isn't full. Two students can't both take the last place.

**Choice rules**
- One choice per student per weekday per term. Choosing again replaces the earlier choice.
- Clearing a choice also needs Evening Prep and open choices.
- Staff placing students can go over capacity or outside the year groups after an "anyway?" warning **(page only)**.

**OH registers** (`/other-half/register`)
- The register lists the students who chose the activity.
- Marks go into the normal attendance record, at the OH period, tagged with the activity.
- A student already marked in another activity that day can't be marked again.
- Registers can't be taken for a future date.

**Absentees** (248)
- `/other-half/absentees` lists, for one day:
  - students marked absent in OH, showing whether they were in school earlier that day ("find these first");
  - students on an activity whose register hasn't marked them;
  - students with no activity chosen for that day.
- It is for SMT, the coordinator and admins.

**Timetables**
- Students, parents and the student record show the chosen activity in the OH slot for the current term.
- Staff see the activities they run, and clicking one opens the register.
- OH outstanding registers appear in Registers Not Done (157). The rules are in [§5](#5-registers-and-attendance).

---

## 5. Registers and attendance

**Who can mark**
- **Any member of staff can mark any register** (the school's decision, 27 Sept 2026).
- Parents can read their own children's attendance. Students can't read attendance.

**Rules for marks**
- One mark per student, per date, per period. Saving again overwrites.
- **No register can be saved for a future date** (146). Past dates are allowed after a confirmation **(page only)**.
- A **late** mark needs the minutes late (0–600). While the lesson is running the box suggests the minutes since the start.
- Changes and deletions of marks are logged in Change History. Taking a register isn't logged.
- Next to each student, the register shows their other marks today as coloured badges (M, L1–L6, OH, EP).
- A subject class's register can show each student's last grade in that subject, but only after the teacher presses **Show last grades**. It is hidden by default because the register is often on the classroom screen **(page only)**.

**Registers Not Done** (`/pastoral/registers-not-done`)

A class lesson is listed when all of these are true:
- it is timetabled today, inside term dates;
- it is **more than 15 minutes** past its start;
- the class has at least one student;
- **none** of those students has a mark for that period.

How the list behaves:
- It stays listed for the rest of the day.
- It goes to the lesson's own teacher if Nova-T gives that lesson a different teacher (182).
- OH activities are listed the same way, 15 minutes after that day's OH start, if at least one student has chosen the activity (157).
- The page is open to pastoral, houseparent, SMT and admin. Each teacher also sees a banner on their own timetable with their overdue count.

**Register alerts** (`/admin/register-alerts`)
- Every 15 minutes, outstanding registers are copied into a permanent alert list: one per lesson per day, and one per OH activity per member of staff per day.
- An alert stays even if the register is taken later. Someone must mark it resolved.
- HR, the school office and admins can see and resolve alerts.

**Bell times** (`/admin/bell-times`, admin only)
- Each weekday has its own sessions and times. With no row for a session, it doesn't run that day.
- Saving a bell time moves every lesson in that period to the new time.
- A session can't be removed from a day while lessons are timetabled in it.
- Bell times also decide which days and times OH runs, and when students can choose OH (Evening Prep).

**Current bell times**

| Session | Mon–Thu | Fri |
|---|---|---|
| Registration (M) | 08:00–08:55 | 08:00–08:25 |
| L1 | 09:00–09:50 | 08:30–09:10 |
| L2 | 09:55–10:50 | 09:15–09:55 |
| L3 | 11:15–12:05 | 10:00–10:40 |
| L4 | 12:10–13:00 | 11:20–12:00 |
| L5 | 13:35–14:25 | 12:05–12:45 |
| L6 | 14:30–15:25 | 13:20–14:00 |
| The Other Half (OH) | 15:30–16:15 | 14:05–14:50 |
| Evening Prep (EP) | 19:00–21:00 | 19:00–21:00 |

---

## 6. Timetable, classes and Nova-T imports

**Who can change what**
- Only admins can change classes, lessons, staff commitments and bell times.
- Admins, Heads of Department and pastoral staff can move students between classes (104, 105).
- The import pages are admin-only.

**A lesson can have its own teacher and room** (182)
- Where Nova-T gives a single lesson a different teacher or room from the class, it is stored on that lesson.
- Timetables, printed timetables, Registers Not Done and alerts all use the lesson's own teacher and room first.

**Nova-T timetable import** (`/admin/import-classes`)
- A lesson's subject comes **only** from the subject code (e.g. `10LI/El` → `El` = Literature). Subject codes are maintained in SQL, not on the Subject Settings page.
- `Oh` and `Sa` groups are skipped.
- The file is treated as the complete list of each class's lessons: lessons no longer in it are removed. A class with nothing readable in the file is never emptied.
- Everything is previewed before it is applied.
- Classes missing from the file are offered for deletion. Empty classes are pre-ticked; classes with students need someone to decide.

**Student class import** (`/admin/import-timetable`)
- It adds enrolments and swaps a student within a block (a set change).
- By default it also removes enrolments the export no longer lists, but only for students in the file. This can be unticked.
- In an ordinary block a student can be in only one class.

**Other timetable rules**
- A student's form must be a real mentor group, and their mentor group follows it automatically (102).
- Staff commitments (meetings and part-time non-working periods, from NCLASS.DAT) block only that person's own timetable slot. They have no register.

---

## 7. Tuckshop

**Who can order**
- **Only students can order, and only for themselves**, from the student portal.
- Parents can see balances and purchases, but can't order.
- Each student has one order per tuckshop day. Saving replaces the whole basket. Cancelling keeps the order on record as "cancelled".
- Orders can only be made or changed through Formwork's ordering function. Nobody can edit the order tables directly (160, 214).

**Ordering windows** (edited at `/tuckshop/ordering`, 187)

| Tuckshop day | Ordering opens | Ordering closes |
|---|---|---|
| Wednesday | Monday 5:00pm | Tuesday 9:00am |
| Saturday | Wednesday 7:00pm | Thursday 11:00pm |

- Tuckshop, bursar and admin can add, move or remove tuckshop days and times.
- Students can place, change or cancel only while the window is open. Outside it they are told when it opens or when it closed.
- In the last 12 hours before a window closes, students see a red warning saying whether they have ordered **(page only)**.
- There are no scheduled jobs: the window is worked out from the time whenever someone orders.

**Closing ordering by hand** (119, 170)
- Tuckshop, bursar or admin can close all student ordering until a chosen future date. It reopens by itself at midnight on that date.
- "Reopen ordering now" undoes it early.
- Closing does not clear orders already placed.
- Special sessions aren't affected.

**Quantity limits** (171, 180, 242). These apply to staff as well as students.
- **At most 2 of any one item.**
- **At most 2 food items in total per tuckshop day.** Drinks count as food, so 1 Gala + 1 Pepsi is fine but 2 Gala + 1 Pepsi is not.
- The limit counts what has already been handed out for that day. Cancelled orders don't count.
- Non-food items (toiletries, stationery) have no total limit.
- The **Water Bottle** is a reusable container, so it is not food (181).
- Whether an item is food is ticked on Items & Prices.
- Students can only order items switched on for sale.

**Special sessions** (241, 242)
- These are one-off ordering windows (for example "Nigerian Independence", delivering Thursday 1 October). Each has its own opening and closing times and its own list of items.
- A session replaces the weekly window for its date and ignores a manual closure.
- Each session has its own limits: per item (default 2), food (default 2) and other items (default no limit). The Independence session allows 1 drink and 1 other item.
- Per item can't usefully go above 2, because every order line is capped at 2.
- Tuckshop, bursar and admin manage sessions.

**Money**
- A balance is the student's "Tuckshop" charges on their fee invoice, minus their tuckshop purchases.
- **Nothing is charged when ordering.** The balance goes down only when the order is marked given at hand-out, or when staff sell at the counter.
- The price used is the item's price **at that moment**, so a price change between ordering and hand-out changes what the student pays.
- **There is no balance check**, so a balance can go negative ("owing").
- Top-up: staff enter a target balance (default ₦40,000). The difference is added to the student's fee invoice as a "Tuck Shop Recharge". Top-ups can be done for one student, a form, a year or everyone.
- Paid top-up (`/bursar/tuckshop-top-up`, bursar only, 273): the bursar records the money on Record a Payment first, then adds all or part of that payment to the student's balance. The recharge goes on the payment's own invoice, so no unpaid bill is created. A payment can't be used for more than it was, and can't be deleted while credit taken from it remains.
- Counter sales (`/tuckshop/purchase`) have no limits and no window.

**Hand-out** (`/tuckshop/hand-out`, 228–233)
- Open to the **tuckshop and tuckshop_owner roles only**. Admins and the bursar are shut out.
- Tapping a student marks the order given and charges it. Tapping again (after a confirmation) undoes it and refunds the charge exactly.
- If some items weren't available, staff enter what was actually given, from 0 up to what was ordered. The student is charged only for that, and the original order is kept for comparison.
- **Save and lock** freezes a restaurant's list for the day. It records the numbers given and not given, the value, who saved it and when. While locked, nothing on that list can be marked, undone or edited.
- **Only `tuckshop_owner` can unlock** (cs@, Uju MBA). Being an admin is not enough. Every save and unlock is kept on record.

**Order sheets** (`/tuckshop/order-sheets`)
- A printable summary per restaurant for one delivery date.
- Marked PROVISIONAL until that day's window has closed.

**Who sees which tuckshop pages**

| Page | Roles |
|---|---|
| Sell Items, Top Up, Balances, Preorders, Items & Prices, Ordering, Order Sheets | tuckshop, bursar, tuckshop_owner, admin |
| Hand Out Orders | tuckshop, tuckshop_owner **only** |

---

## 8. Behaviour, appeals and detentions

**Logging events**
- Any member of staff can log an event. Students and parents can't.
- **Points always come from the category**, and every event must have one. Staff can't type points.
- Only admins set the categories and their points (`/admin/lookups`).
- Negative categories range from −1 (e.g. late to lesson) to −5 (e.g. bullying, academic dishonesty, Stage 5). Positive categories range from +1 to +5.
- **"Logged by" is always the signed-in person**, so nobody can log an event under a colleague's name (138).
- The event's class is worked out from the class the teacher shares with the student (145). Parents see the subject, not the teacher.
- **Serious means −5.** A −5 event can't be saved without a written explanation (166).
- Staff can attach one picture per logging, on positive events only (migration 297, the principal, 30 Sept 2026): the picture field is hidden for negative events and the database refuses a picture on one. Pictures are shrunk in the browser and must be under about 150 KB.

**Editing and deleting** (207, 208, 211)
- The teacher who logged an event can edit it, and so can pastoral, houseparent, head of boarding, SMT, school office and admin.
- Only the comment and the category can change, and the category must stay the same kind (negative stays negative).
- Detentions are recalculated after an edit.
- Events withdrawn on appeal can't be edited.
- Only admins can delete an event.
- Changes and deletions are logged in Change History.

**What parents see**
- Positive events are always visible to parents.
- **Negative events are hidden from parents until reviewed** at `/behaviour/review` (238, 239):
  - Events with a picture: SMT or admin decide. They can send the text with the picture, send the text only, or decline.
  - −5 events without a picture: the school office or admin release the text.
  - −1 to −4 events without a picture never go to parents.
- SMT get a "picture to check" notice in their Formwork inbox.

**Behaviour alert emails** (168, 202)
- **When it's sent:** when a negative event is logged and either it is −5, or the student's negative total for the Saturday–Friday week reaches −8 or worse.
- **Who gets it:** it is sent to cs@, copied to every SMT member and sro@. Houseparents no longer receive it.
- **Replies** go to guardian.counselling@.

**Appeals**
- Students can appeal their own negative events, one appeal per event. Parents can't appeal.
- An appeal always starts as pending.
- Pastoral, houseparent, head of boarding, SMT and admin decide appeals. Any member of staff can read decided appeals.
- **If upheld:**
  - the event is voided: points set to 0, with the original kept on record (222);
  - it disappears from the student and parent portals;
  - its detention is cancelled;
  - the weekly detention is cancelled too if the week no longer reaches −10;
  - the student is told.

**Detentions**
- **Booked automatically** for the Friday of the Saturday–Friday week, when either:
  - a single −5 event is logged, or
  - the student's negative total for the week reaches **−10 or worse**. Positive points don't offset this.
- Staff can't add or delete detentions by hand.
- Detentions take place in CG4, after lesson 7.
- Statuses are scheduled, attended, missed and cancelled. Whoever has the `/detention` page can update them (240).
- **The student** (not parents) gets an email and a Formwork inbox notice when a detention is booked, a reminder at **7:30pm on Thursday**, and a notice if it is cancelled. Replies go to SMT.

---

## 9. Assessment, results and reports

**Entering scores** (`/results/enter`)
- A teacher can enter or change scores only for students in their own classes, in that class's subject (129).
- Assessment managers and admins can enter or change any score. Assessment users can too, but can't delete.
- Scores are percentages (0–100). The grade is worked out from the subject's boundaries for that year group when the score is typed, and saved with it. Changing boundaries later does **not** regrade saved scores.
- Only the current school year's result sets can be picked for entry **(page only)**.
- There is one score per student, per subject, per result set.

**Deleting a score** (236)
- The class teacher can delete their own students' scores.
- A Head of Department can delete scores in their department's subjects.
- Assessment managers and admins can delete any score.
- Assessment users can't delete.

**Every grade change is logged permanently** in Grade History (215)
- This covers every insert, change and delete of scores, target grades, transcript grades and homework grades, with the old and new grade and who did it.
- Nobody can edit or delete the log, even from the database editor.
- It is readable by SMT, assessment managers and admins at `/assessments/grade-history`. Homework grades and student group marks in it are readable by SMT and admins only, not assessment managers, and are hidden unless "including homework and group marks" is chosen (278, 287).

**Result sets**
- A result set is a calendar event with the "result set" box ticked. SMT and admins manage the calendar (205).
- Missing Grades (`/results/missing`) lists, class by class, who still has no mark. A subject is only expected if someone in that year group has a mark for it.

**End-of-term exams** (246, 247, 252)
- There is one result set per year group per term, going back to 2017.
- Year 12 has Terms 1 and 2 only, because Term 3 is WAEC.
- Historic grades were loaded into these sets.

**Grade boundaries, aliases and key stages**
- **Any member of staff can edit grade boundaries, subject aliases and subject key stages** (the school's decision, 27 Sept 2026). Boundary changes are not logged.
- Boundaries are set per subject and per year group. Year 12's boundaries are also used as the WAEC boundaries for Years 10–11 on transcripts.
- A subject shows on the Term Test Scores PDF only if it is tagged for the student's key stage.

**Target grades**
- One target per student per subject.
- Assessment managers and admins can set and delete targets. Assessment users can set but not delete.
- A subject with no target of its own borrows one from a related subject (e.g. Further Maths from Maths) (132, 133).
- Portals only show targets for subjects the student takes.
- CAT4/NGRT scores: only assessment managers and admins can change them. Staff and parents can read them; students can't.

**Transcripts** (KS3; KS4/5 in IGCSE and WAEC versions)
- KS3 uses IGCSE only. Year 12 uses WAEC only. Years 10–11 follow whichever version is being printed.
- They read the end-of-term exam sets first, and older transcript grades second.
- Publishing a transcript replaces the previous copy and makes it downloadable by parents and students.

**Report writing**
- One comment per student, per subject, per report period, with Effort, Presentation and Homework judgements. Mentors, houseparents and SMT each write one pastoral comment.
- Comments move draft → submitted → checked. The author can only edit while the comment is a draft.
- Checkers, SMT and admin can approve a comment or send it back.
- Only **checked** comments are printed on the written report.
- The AI "draft a comment" and "check comments" buttons only use what the page sends. Only people with the relevant page can use them.

**Homework** (278, 279, 291, 295–296; Years 10 and 11 from 30 Sept 2026, `/homework`)
- **Which classes:** homework can only be set for classes an admin has switched on. Since 30 Sept 2026 (295) that is every Year 10 and 11 teaching group; mentor groups and Prep are not included. A new Year 10 or 11 class (from a later timetable import, or next year's classes) is switched on automatically, unless it is a mentor group or Prep (296). An admin can still switch a class off. Teachers, Heads of Department and SMT have the `/homework` page. A teacher's own classes are shown as buttons; a drop-down holds the other classes in the subjects they teach, which they can open to see what colleagues have set but not edit or see grades, and any classes they manage as Head of Department or admin.
- **Who can set, edit and mark it:** the class teacher, the teacher of any single lesson of the class, the Head of Department for the subject, and admins.
- **Where it's set:** from the class register (`/attendance`), where a Homework panel appears for classes the teacher can set homework for, or from `/homework`, which also has the mark books.
- **Setting it:** each piece of homework has a title (at most 10 characters, so it fits the mark sheet; 290), instructions (plain text), a deadline (a date, and optionally the lesson it's due in, which must be one of the class's lessons that day) and a grading system: Mark out of …, Percentage, A*–U, 9–1, WAEC, Effort 1–4, Complete / Incomplete or Not graded. Any grading system also accepts "Not handed in" and "Excused".
- **Grades:** a grade must fit the grading system (a mark between 0 and the maximum, or one of the list's grades). A mark is converted to a grade from the subject's grade boundaries for the class's year group (289): 11 out of 14 is 79%, which is a B. The database works out the grade; a percentage between two bands takes the lower one. Changing a boundary later doesn't regrade saved homework marks. A grade can only be recorded for a student in the class. Once any grade is recorded, the grading system can't be changed and the homework can't be deleted, only withdrawn.
- **Mark sheet:** on `/homework`, each class has a mark sheet: one row per student and one column per homework due between two dates (the current term by default). Each column is headed by the title and the due date. It shows each student's average of their number-marked homework, with its grade from the subject's boundaries, how many were marked and how many weren't handed in, and it downloads as CSV. It shows only what the person may already see.
- **Who sees grades:** the class's teachers, the Head of Department, SMT and admins. Other staff (mentors, pastoral, assessment managers) can see what homework was set but not the grades.
- **Marks follow the student** (291): if a student changes class or teacher, whoever teaches them in that subject now can see all their homework marks in it for this school year, from any class. The teacher who gave the marks still sees them too.
- **Joining a class late** (298): Formwork records the day a student joins each class. Homework due before that day is not shown to them and they are left out of its mark book and the mark sheet, unless they already have a mark for it. Students already in a class on 1 Oct 2026 count as joining on 1 Sept 2026.
- **Student view:** on `/homework`, staff can open any class they can see there in "Student view", which shows that class's week of homework exactly as its students see it, without any student's ticks or grades.
- **Students** see their classes' homework on their timetable (on the lesson it's due in) and on a Homework page laid out by day. They see their **own** grade and comment only after the teacher releases the marks, and only for the current school year.
- **Files and links** (281): the teacher can attach files (PDF, Word, PowerPoint, Excel, OpenDocument, images, text or CSV, up to 20 MB each) and `https://` links to a homework. The same people who can set it can add or remove them. Anyone who can see the homework can open them: all staff, and students in the class while it is set. Files are private and open through a link that lasts ten minutes. Students can't upload anything yet.
- **Ticking done** (288): a student can tick their own homework as done, and untick it, until a grade is released. It is their own note, not a hand-in or a grade. The class's teachers, the Head of Department, SMT and admins see how many students ticked each homework on the homework list and the register's Homework panel, and each student's tick in the mark book. Nobody else does.
- **Colours on the student's screens:** red is overdue or not handed in, amber is due today, green is ticked done (the card shrinks to just the subject), purple is graded.
- **Parents** see nothing about homework except the Homework grade on the published written report.
- **Reports** (291): while writing a subject comment, the teacher sees each student's homework this term in that subject (from any class): average, grade, how many were marked and how many weren't handed in. The Homework judgement is suggested from the average (80% and over Excellent, 60–79 Good, 40–59 Satisfactory, under 40 Needs Improvement); the teacher can change it. Checkers see the same figures. Every mark recorded for homework due that term counts, whether or not released to students; Not handed in is counted separately, not as zero. The printed report shows Homework as the grade of the average only (e.g. B), never the percentage; a subject with no homework marks shows the teacher's judgement. Transcripts, result sets and target grades still never use homework.
- **No notifications:** setting homework or releasing marks sends no email or inbox message.

**Certificates:** these are behaviour-points certificates. See the gap in [§14](#14-known-gaps-and-inconsistencies-found-while-writing-this).

---

## 10. Pastoral, boarding, clinic and HR

**Houseparents and head of boarding**
- Houseparents' student and behaviour pages default to their own house. Houseparents with other school-wide jobs get a "Whole school" switch. This is a display filter only.
- The head of boarding has houseparent powers across all houses and counts as pastoral for detentions, appeals and editing events (224).

**Mentors:** a mentor's students are the students in their mentor-group class (127).

**Clinic** (128–130)
- Covers medical records, conditions, the sick-bay log, immunisations, BMI and resumption screenings.
- **Only the nurse role and admins can see or change any of it.** Teachers, pastoral staff and parents have no access.

**Staff HR records** (`/staff/records`)
- HR and SMT can read them. Only HR (and admin) can edit.
- Nationality must be Nigerian, British or Other.

**Birthdays** (`/pastoral/birthdays`)
- Shows the next 7 days of birthdays to admin, SMT, pastoral, houseparent and the school office.
- Today's names are shown to staff and students after they sign in, never to parents.

---

## 11. Email and messages

**How email is sent**
- **Every email goes through one queue**, is sent from mis@abc.sch.ng, and carries a Reply-To.
- The queue sends roughly 12 emails a minute and retries failures up to 6 times.

**Where replies go** (set at `/admin/email-replies`, SMT and admin only)

| Email | Replies go to |
|---|---|
| Message to a parent | sro@ |
| Message to staff or a student | the member of staff who sent it |
| Welcome letters | sro@ |
| Behaviour alert | guardian.counselling@ |
| Detention notices | all SMT |
| Anything else | sro@ |

**Pausing parent email** (173)
- A single admin switch stops every email to parents. Inbox copies are still delivered.
- It is currently **off**, meaning emails are being sent.

**Sending messages**
- Only SMT, pastoral and the school office (and admins) can send messages (091).
- A message to one person is emailed to them as well as going to their Formwork inbox.
- A message to a group of students (all students, year groups, forms, boarding houses, mentor groups, teaching classes, Other Half activities, sports houses or student groups (284); several at once) can go to the students, their parents, or both (277). **Parents in a group message are emailed too**, unless parent emails are paused. Students and staff in a group message get it in their inbox only.
- Parents without a Formwork login (never sent their welcome letter) can't be reached by a message. "Check recipient count" says how many there are.
- Group messages reach active students, and the parents of active students, only.
- Everyone sees only their own inbox.
- `/comms/history` lists sent messages and automatic emails, with their delivery status but never the email body, because welcome emails contain passwords.

**Scheduled jobs**

| Job | When | Sends email? |
|---|---|---|
| Email queue | every 15 seconds | Yes |
| Detention reminder | Thursdays 7:30pm | Yes |
| Register alerts capture | every 15 minutes | No |

---

## 12. Fees

**Who can see and change fees**
- The bursar and SMT can see all fees.
- Parents see their own children's fees, and only for terms SMT has **published** to them.
- Only the bursar can set prices, create invoices, add or delete charges, record payments and apply discounts.
- Nobody can edit or delete a payment or an invoice through the app.
- The bursar or SMT can charge a group of active students (one student, a form, a year or everyone), and can undo a batch.

**How invoices behave**
- An invoice's status (unpaid, part-paid or paid) is worked out automatically after every payment or charge change.
- "Recorded by" on payments and "created by" on charge batches are always the signed-in person.
- Fee changes are logged in Change History, which the bursar **cannot** read (deliberate: part of its purpose is checking fee changes).

---

## 13. Audit logs, backups and safety

**Change History** (`/admin/change-history`, SMT and admin only)
- This is a permanent log that can't be edited. It records who made a change (from their sign-in), when, and the old and new values. It covers:
  - **registers:** attendance changes and deletions;
  - **fees:** charges, discounts, prices, payment changes, invoice deletions;
  - **behaviour:** changes and deletions;
  - **access:** roles, page permissions, logins;
  - **parent links;**
  - **email:** reply-to settings.
  - **groups:** student groups, who is in them and who runs them (284).
  - **students:** every student added, changed or deleted, with old and new values (286). The photo is left out of the log, though the log says it changed.
- Changes made directly in the database show as "Principal (direct)".

**Grade History** covers grades (see [§9](#9-assessment-results-and-reports)).

**Who did it:** "who did it" columns are filled in from the signed-in account, not from anything the page sends.

**Backups**
- A full database backup runs every night. Admins can also start one.
- Kept: every backup for 14 days, Sunday backups for 8 weeks, and 1st-of-month backups for 12 months.
- Only admins can download a backup.
- Photos and uploaded documents are **not** included.

**Backup mode:** an admin can freeze all changes for 1–60 minutes (default 30). It switches itself off at the end.

**Calendar and terms:** SMT can add and edit calendar events and terms. Only admins can delete a term.

**Parents' calendar subscription** (274): each parent has a private link on `/parent-portal/calendar` that their phone or Google/Outlook calendar re-checks every few hours, so event changes reach them by themselves. A parent can make a new link, which stops the old one. The feed holds only parent-visible events (no Teacher Assessment weeks or report periods) from the current academic year on, and goes empty once none of the parent's children is still at the school.

**Demo account:** the staff_demo training account has been removed. There is no practice login.

---

## 14. Known gaps and inconsistencies found while writing this

None of these has been fixed yet. They are listed so the school can decide what to do.

**Things that don't work as the page suggests**
1. **The gradebook CSV import and the quick-add form on `/results` can't save.** They send a result type ("Exam" / "ReLP") that the database no longer accepts. Score entry through `/results/enter` is unaffected.
2. **Certificates:** the page offers 100 / **200** / 500 points, but the database only accepts 100 / 500 / **1000**. So recording a Silver (200) fails without any message. Totals may also be understated for students with many events, because only the first 1,000 events are read.
3. **Subject Settings:** assessment managers can open the page, but only admins can save a subject's display name, department or "reads target from" subject. For anyone else, saving silently changes nothing.
4. **Decimal scores** such as 89.5 can fall between whole-number grade bands on `/results/enter` and be saved with no grade.
5. **`/behaviour/review` page access** is given to admin, HR and SMT, but not the school office, even though the office reviews −5 events without pictures.

**Rules that are weaker than they look**

6. **Any member of staff can change whether a behaviour event is visible to parents** by sending a direct request, skipping the review page.
7. **The −8 weekly behaviour alert repeats** on every further negative event that week.
8. **The forced password change is page only.** Also, parent logins made by the school office, and all auto-created staff and student logins, are never forced to change their first password.
9. **Report checkers** can see and edit every comment in the period, not only the scope set for them.
10. **HR can give themselves any role except admin**, including smt and bursar. It is logged, but not blocked.

**The Other Half**

11. A retired activity stays on the timetables of students who had already chosen it.
12. An activity with past registers but no current choices can be deleted, and its past marks then lose their activity name.
13. Changing an activity's year groups or capacity doesn't re-check the students already on it.
14. Printed timetables don't show OH choices.
15. Nobody currently holds the `other_half` coordinator role.

**Tuckshop**

16. The `tuckshop_owner` role can open pages whose actions the database only allows tuckshop, bursar and admin to perform. This doesn't matter today, because the only owner is also an admin.
17. A top-up adds a charge to the parent's invoice with no matching payment, so the invoice shows as unpaid.
18. Top-ups by a tuckshop-only user may be refused by the fee-charging step, which allows only bursar, SMT and admin. This needs testing.

**Registers**

19. Registers Not Done checks term dates only, so holidays inside a term still produce "not done" rows and alerts.
20. A single mark for any student in a class clears that class's lesson from the list.

**Leavers**

21. A leaving date that passes without anyone saving the record leaves the student active, and their login switched on.

**Behaviour**

22. Deleting a behaviour event that has already produced a detention will probably fail.
