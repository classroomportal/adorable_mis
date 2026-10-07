# Formwork: what the system does, and the rules it enforces

**As of 29 September 2026** (migrations up to 254). Written for school leaders, not developers: it describes what Formwork *does* today, who can do what, and the limits and times it enforces.

Where a rule has changed several times, only the current version is given. Migration numbers are in brackets for anyone who needs to trace a rule back.

**How to read the rules**

- A rule with no label is **enforced by the database**. It holds whichever way someone reaches the data, including by copying and editing a request from the browser.
- **(page only)** means only the web page enforces the rule. It guides normal use but is not a security boundary.
- **Page access vs. data access.** Which tiles and pages a role can *see* is set at `/admin/permissions`. What a person can actually *read or change* is decided separately by the database. Giving a role a page does not give it the data behind the page. The page's **What they can do** view shows, for each role, what it can view, add, edit and delete, worked out live from those database rules ("Own only" means only records tied to the person, such as their own classes); **Compare roles** shows every page against every role. For certificates, sick-bay records, grade boundaries, behaviour, attendance, reports, results, homework, students and families, staff and HR, tuckshop, The Other Half, student groups, admissions, fees, the timetable, the calendar and next year's plan the abilities are tick boxes there (admins only; you see who gains or loses before it saves, and it is logged); more areas follow. Only assessment managers can edit grade boundaries (3 Oct 2026). The principal's own decisions (only the office adds students, fee prices need two approvals, the history logs can't be edited) are padlocked and can't be ticked.
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

**Staff roles in use:** admin, smt, hr, pastoral, houseparent, head_of_boarding, assessment_manager, assessment_user, teacher, bursar, school_office, admissions, tuckshop, tuckshop_owner, head_of_department, mentor, nurse, dsl, other_half.

**Admins**
- "Admin" is a separate account setting, not one of the staff roles. There are 3 admin accounts (175).
- Admins pass almost every check automatically. The exceptions are the tuckshop hand-out list and unlocking it (see [§7](#7-tuckshop)).

**Who can change permissions**
- Only admins can edit page permissions, the per-field student edit grants and departments.
- HR can add or remove any staff role except admin, including roles such as smt or bursar, and including for themselves (112).
- Every role and permission change is logged permanently in Change History.

**Departments and scopes**
- A role can be tied to one department (Science, Maths, Languages, Creative, Humanities) or to one boarding house (051).
- A Head of Department's Class Progress view is filtered to their department **(page only)**. SMT and admins see every class, even if they are also a Head of Department (312), as do assessment, pastoral and boarding staff. A teacher sees only the classes they teach, as class teacher or for any single lesson (1 Oct 2026). Class Progress is a big tile on the top row for Heads of Department, SMT and admins; other staff with the page (teachers, pastoral, assessment staff) find it on the Assessment card.
- A Head of Department's right to delete scores is limited to their department by the database.
- Heads of Department can move any student into any class, not only classes in their department (104).

**Tuckshop roles:** `tuckshop` and `tuckshop_owner` open only the `/tuckshop` pages (231).

**Bursar:** a bursar who isn't an admin sees a plainer home page (no top rows of tiles); like everyone else's, its cards follow the pages the bursar's roles can open, so ticking a page at Permissions makes its card appear.

**Server routes**
- Formwork has four: the backup route, the two AI comment routes, and the parents' calendar feed.
- Each one checks the caller's sign-in and page access before doing anything, except the calendar feed (274). Calendar apps can't sign in, so each parent's secret link is the check instead; the principal agreed this on 30 Sept 2026, and it is the build check's only exception.
- The build fails if a route is missing that check. Backup is admin-only whatever the permissions page says.

---

**Dashboard tile order** (280, 282, 283)
- The order of the big tiles on students' home page and portal, and of the staff dashboard (the top row with My Timetable, Calendar, My Children and Class Progress, row 2 with Log behaviour, Inbox, Missed Lessons and Homework Monitor, and the larger tiles underneath, 282–283, 292–294; the numbers of active students, staff and behaviour alerts are shown on the Students, Staff & Access and Pastoral tiles), is set once for everyone at `/admin/tile-order` (Arrange Tiles). Only admins have that page for now. A page with a big tile isn't also a link on a card (1 Oct 2026), so the cards stay short.
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

**Sign-in safeguards** (372)
- Every login also has a Formwork password, even when the person signs in with Google. Changing a Google password doesn't change it.
- A login can be set to **Google only**: a password sign-in is then refused, even with the right password. The principal's login is set this way (5 Oct 2026). It is set in the database, never from the app, so a signed-in admin can't switch it off.
- A login can get a **new-device email**: the first sign-in from a phone or browser it hasn't used before emails its owner (time, device, network, how they signed in). The principal's login has this. A browser update counts as a new device.
- Anyone can end every other sign-in on their account with **Sign out all other devices** on the Change Password page. A device signed out this way can carry on for up to an hour on the pass it already holds.

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
- their recent marks, and can appeal a mark that doesn't match their marked paper (354)
- timetable
- tuckshop ordering
- Other Half choices
- published documents

Students **cannot** see their own CAT4/NGRT scores (220) or their attendance.

**View as Parent:** admin, SMT and the school office can see a parent's portal, using only their own access (234).

**Who added a student** (286): every student added through Formwork records who added them and when, and nobody can change that afterwards. Students added before 30 Sept 2026 have no record, except the two Chibuezes (Victory NNAMOKO, 30 Sept, from Supabase's request logs).

**Names are tidied when saved** (286): spaces at the start or end of a name are removed, and double spaces inside a name become one, for students, applicants, parents and staff.

**Sports houses** (380, `/students/sports-houses` on the Students card): lists current students with no sports house and shows how many boys and girls each house has in each year, counting choices not yet saved. It suggests the house with the fewest of that student's sex in their year. The school office, SMT and pastoral can open it; only those allowed to edit the sports-house field (the school office and admins) can save, and saving never overwrites a house someone has already given. The houses are Citrine, Diamond, Garnet and Sapphire (spelled "Saphire" until 381).

**Student groups** (284, `/groups` under Administration; design in `docs/student-groups-design.md`)
- A group is a list of students for an activity, a club, the prefects, marks or messages. Only **SMT, pastoral, the school office and admins** can create a group, change it, archive it, or add and remove students and the staff who run it. Teachers can open `/groups` and look groups up but not change them.
- All staff can see every group and who is in it.
- **Students and parents** (300) see a Groups tile on their portal, only when there is something to show. A student sees the groups they are in that are marked "Staff and the students in it" or "Staff, the students and their parents"; a parent sees only those marked for parents, and only for children still at the school. They see the group's name, description, kind and who runs it, never who else is in it and never marks. Archived groups, groups from an earlier school year and groups built by the system are never shown.
- Only current students can be added. A student who leaves stays on the list, marked as left, and stops getting the group's messages.
- A group is archived, never deleted. An archived group can't be messaged or have students added.
- **Groups built by the system** (285, 301, 302, `/groups/build`): SMT, pastoral and the school office choose a rule and all its settings each time, see who matches today with the reason, untick anyone, and save the list. The rules are:
  - **Negative behaviour:** negative points between two dates add up to a chosen threshold or worse (e.g. −6). Withdrawn events don't count.
  - **Below target:** the latest grade in a subject, counting only results from a chosen date, is below target in at least a chosen number of subjects. Grades are compared by their points; WAEC grades only against WAEC targets.
  - **Positive behaviour** (301): positive points between two dates add up to a chosen total or more (e.g. +40). Withdrawn events don't count.
  - **Term exam average** (301): a student's average percentage across their subjects in one chosen term exam is below, or at or above, a chosen mark. Marks without a score are skipped. Last year's exams can be chosen; each student is judged on the exam they sat then.
  - **A subject** (302): in one chosen subject, the latest grade since a chosen date is below a chosen grade, or below the student's target in it. Grades are compared by their points; a WAEC grade only against a WAEC grade.
  - **Attendance** (301): present or late as a percentage of every register mark between two dates (the same sum parents see) is below a chosen percentage. Students with fewer marks than a chosen number are left out.
  - All six can be limited to chosen year groups, forms and boarding houses. Only current students are picked.
- A built group records its rule, settings and date, is always staff-only, and never changes by itself. Students can still be added or taken out by hand. "Build again" starts a new dated group from the same settings, which can be changed first. Only students the rule picks can be saved into a built group.
- Every change to a group, its students or its staff is logged in Change History under **groups**.
- **Group marks** (287): a group can have mark sheets (a test or occasion, a date, and a grading system from the homework list). The staff who run the group, SMT, pastoral and the school office record and read the marks; other staff only see that a sheet exists. Students and parents see nothing. A mark must fit the grading system, or be Absent, Not handed in or Excused, and can only be for a student in the group. Once a sheet has marks its grading system can't change and it can only be withdrawn, not deleted. An archived group's marks can't be changed. Group marks are **not part of reporting** and never feed reports, transcripts, result sets or targets. Every change is in Grade History, readable by SMT and admins only (like homework).
- A student's profile has a Groups tile listing the groups they are in.
- **Placing a group in the Other Half** (302): see section 4, "Placed and locked by the school".

---

## 4. The Other Half

**OH is run in Formwork, not Nova-T** (156)
- Activities, staff, rooms, year groups and student choices live only in Formwork.
- The Nova-T importer skips any group coded `Oh` or `Sa`, so an import can never change OH. Sports Academy is an OH activity students choose, and so is Prep for those who don't do sports (386).
- Nova-T's old whole-year OH and Sports Academy groups were deleted (158).

**Days each year group has OH** (384, 386)
- A tick grid at **Other Half Days** (`/other-half/year-days`, linked from the Timetable card) says which year groups have OH on which days (the principal, 6 Oct 2026). As set up: Years 7–11 Monday to Thursday; Year 12 **Mondays and Thursdays only**, because on Tuesdays and Wednesdays they have science lessons in the OH period. Friday has an OH slot in the bell times but no activities, so nobody has it ticked.
- SMT and the Other Half coordinator change it. It refuses to untick a day while that year still has activities or choices on it, and refuses to tick a day on which that year has lessons in the OH period. Changes are logged in Change History under Other Half.
- The grid is checked in three places:
  - **Activities:** an activity can only be opened to the years ticked for its day (the Activities form greys out the others), and a student can only choose, or be placed in, an activity on a ticked day.
  - **The Nova-T import** leaves out any lesson in the OH period on a day its year has OH, and lists it on the preview. A class with no other lessons is left out whole. The database refuses such a lesson too, however it is added.
  - **Registers:** a student in a lesson then can't be marked on an OH register (385, below).
- Prep for students who don't do sports is the OH activity **Prep**, not a Nova-T class. Nova-T's Sports block puts a Prep group in Year 10's Tuesday OH period (109/Pr1). It was removed on 6 Oct 2026, and the import now leaves it out.

**Who can do what**

| Action | Who |
|---|---|
| Create, edit, retire or delete activities; set room, staff, year groups and capacity | SMT, the `other_half` coordinator role, admins |
| Open or close student choices for a term, and set a closing time | Same |
| Place, move or remove any student's choice, at any time | Same, at `/other-half/choices`. Not limited to Evening Prep |
| Take an OH register | Any member of staff, one person at a time. Once it is taken, only the person who took it, the school office, the attendance officer and SMT can change it (385) |
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
2. **It is Evening Prep right now** (249). The window is the "EP" row in Bell Times for today, currently 19:00–21:00 Sunday to Friday (Sunday added 4 Oct 2026, migration 362). Moving EP in Bell Times moves the window with it.
3. Choices are open for the term, and the closing time (if one is set) hasn't passed.
4. The activity is active.
5. The student is active and in one of the activity's year groups.
6. The activity isn't full. Two students can't both take the last place.

**Choice rules**
- One choice per student per weekday per term. Choosing again replaces the earlier choice.
- Clearing a choice also needs Evening Prep and open choices.
- Staff placing students can go over capacity or outside the year groups after an "anyway?" warning **(page only)**.

**Placed and locked by the school** (302, the principal's decisions of 1 Oct 2026)
- From a student group's page, SMT, pastoral, the school office, the `other_half` coordinator and admins can put every current student in the group into one activity. It replaces each student's choice for that day only; other days are untouched.
- A group whose kind is **Other Half** (the kind formerly called Activity, renamed 1 Oct 2026) is for the Other Half. When a group built from a rule is saved with that kind, the activity and the lock can be chosen on the same form, and saving places the group in one step. Trips and clubs go under "Other".
- The placement can be **locked until staff unlock it**, **locked until a date** (that day included), or not locked.
- While a lock is in force, the student can't change or clear that day's activity, even during Evening Prep with choices open. The database refuses it.
- When a lock ends (its date passes or staff unlock it), the student **stays in the activity** and may change it at Evening Prep while choices are open.
- A full activity, or one outside a student's year group, gets an "anyway?" warning first and then goes ahead **(page only, the warning)**. So does replacing students' existing choices for that day.
- Students and parents see "Placed by the school" (and the end date, if there is one), **never why**: a list built from grades is staff-only.
- Who locked a placement and when are recorded on it by the database. Staff who manage the Other Half can still move a locked student at `/other-half/choices`; the lock stays with the student's day. Removing the choice there removes the lock too.
- Placements and locks are not yet in Change History.

**OH registers** (`/other-half/register`)
- The register lists the students who chose the activity.
- Marks go into the normal attendance record, at the OH period, tagged with the activity.
- A student already marked in another activity that day can't be marked again.
- **A timetabled lesson always beats the Other Half** (385, the principal, 6 Oct 2026). A student who has a lesson in the OH period that day (Year 12 have science lessons there on Tuesdays and Wednesdays) shows as "In lesson: 12a/Bi1 (Maurice Ekpo)" and can't be marked on an OH register, whichever teacher saves first. Mentor, Prep and Personal Study don't count as lessons here.
- **One person takes the register** (385). Most activities have two or more staff, and the second person used to save over the first one's marks. Now:
  - While someone has the register open, anyone else who opens it sees "Bessie Maduekwe is taking this register (opened 15:02)" and can only view it. It is let go when they save or leave the page, or after 10 minutes without any marking, so a forgotten tab can't block it.
  - Once saved, it belongs to the person who took it. Only they, the school office, the attendance officer and SMT can change it (for example a late arrival). The activity's other staff see it read-only, with the reason.
  - The database enforces both, so an old open tab gets the same answer when it saves.
- Saving sends only the marks that changed, so re-saving doesn't put your name on marks someone else took.
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
- **Any member of staff can mark any register** (the school's decision, 27 Sept 2026). The exception is Other Half registers, which one person takes and only they or office/SMT can then change (see §4).
- Saving a register sends only the marks that changed, so the name on an untouched mark stays that of whoever took it (385). Planned-absence marks are never re-saved: they stay the absence's (389).
- Parents can read their own children's attendance. Students can't read attendance.

**Rules for marks**
- One mark per student, per date, per period. Saving again overwrites.
- **No register can be saved for a future date** (146). Past dates are allowed after a confirmation **(page only)**.
- A **late** mark needs the minutes late (0–600). While the lesson is running the box suggests the minutes since the start.
- Changes and deletions of marks are logged in Change History. Taking a register isn't logged.
- Next to each student, the register shows their other marks today as coloured badges (M, L1–L6, OH, EP).
- A subject class's register can show each student's last grade in that subject, but only after the teacher presses **Show last grades**. It is hidden by default because the register is often on the classroom screen **(page only)**.

**Planned absences** (`/attendance/planned-absences`, migrations 318 and 389)

One attendance code for a student over a run of days, entered once instead of in every register. It can start at a chosen lesson on the first day and end at a chosen lesson on the last (389): one day, Period 3 to Period 5, or "from Period 4 on Monday until Period 1 on Wednesday". No lesson chosen means the whole day.
- Open to school office, attendance officer, pastoral, SMT and admin (Pastoral card). All staff can see the list. The checks happen in the database.
- Only authorised codes: other authorised absence, educational visit, authorised holiday, illness, medical/dental appointment, and **X, Excluded from school** (new in 318, counted as an authorised absence).
- It fills in every period the student has on each day: their timetabled lessons (registration and Evening Prep included) and their Other Half activity. Days outside term dates and days with a holiday on the calendar are skipped.
- Past days and today are filled in as soon as it is saved; later days at 05:30 each morning. The rule that no mark can be saved for a future date still holds.
- **It never overwrites a mark that is already there** (the principal's decision).
- The register shows the code already filled in, marked "planned". **Only the school office and the attendance officer (and admin) can change or delete it** (the principal, 7 Oct 2026, migration 389); for teachers it is read-only, enforced in the database. If the student turns up, the office changes the mark; once the office changes one on a register it becomes an ordinary mark.
- **Change code**: the school office and attendance officer can change an existing planned absence's code; every mark it filled in changes with it.
- A student can't have two planned absences over the same lessons (two on the same day are fine if their lessons don't overlap).
- **End early** (the day, and optionally the lesson, the student is back) removes the marks it filled in from then on; **Cancel** removes all of them. Marks the office has changed are left alone.
- A planned-absence mark doesn't count as the register being taken, so Registers Not Done still lists the lesson until the teacher takes it, unless every student in it already has a mark (a whole class on a visit), when it counts as taken.
- The note is staff-only; parents see only the code on their child's attendance.
- Planned absences, and the marks removed by ending or cancelling one, are logged in Change History under Registers.

**Student Marks** (`/attendance/student-marks`, migration 390)
- The school office and the attendance officer (and admins) choose a student and up to 62 days, and see every lesson on the student's timetable each day (registration, Other Half and Evening Prep included) with the mark entered and who entered it. Days outside term and holidays are left out; any mark on a lesson no longer on the timetable is shown too.
- They can change any single mark, give several ticked lessons the same code, add a missing mark or remove one. Nobody else can use this page or its functions.
- A changed mark shows the office member as the person who gave it; a planned-absence mark changed here becomes an ordinary mark. Unchanged marks are not touched.
- No mark can be entered for a day that hasn't happened. Correcting an absent mark withdraws its automatic missing-a-lesson negative, as on a register.
- Every change and removal is logged in Change History under Registers.

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

**Missed Lessons** (`/pastoral/missed-lessons`, migrations 307–308)

A tile on the staff dashboard's second row, with today's count. For one day (today unless another date is picked), it lists every active student who:
- was marked **present or late** at least once that day, and
- was marked **absent without a reason** (unauthorised: No reason given, Unauthorised absence) at one or more other periods, before or after.

How the list behaves:
- Authorised absences (illness, appointments and so on) never count as missed.
- Each row shows the day's marks as badges (M, L1–L6, OH, EP) and, for each missed period, the lesson the student should have been in (their class at that period, using the lesson's own teacher first), the code, and who marked it. For a past day the lesson comes from today's classes and timetable, so it can be out of date after a class change.
- Today's list refreshes every minute.
- Open to SMT, pastoral, school office, attendance officer (migration 310) and admin. The list is worked out in the database (`students_missed_lessons()`), which refuses anyone else.

**Missed-lesson pop-up on the office's screens** (migration 309)

A full-screen flashing pop-up, on whatever Formwork page is open, for anyone whose role is granted **Missed-lesson pop-ups** at Permissions (school office and attendance officer to start with). It appears when, today:
- a period started **at least 15 minutes ago**, and
- a student is marked **absent without a reason** (unauthorised) in that period's register, and
- the same student was marked **present or late at an earlier period** today.

How it behaves:
- It shows who, their year, mentor group and house, the lesson, teacher (the cover teacher if the lesson is covered) and room they should be in, where they were last seen, and who marked them absent.
- It also shows **today's registers** for that student, period by period: the lesson and its teacher, the mark (present, late, absent with its code, or not taken yet) and **who marked it** (migration 382, the principal, 6 Oct 2026).
- And it shows what other staff have answered to their own pop-up (below): "X has sent them to the lesson" with the time and where they were, and who has said "Not with me".
- **Seen: dealing with it** (with an optional note) clears that student and period from every office screen and records who saw it and when.
- If the teacher corrects the mark (to present, late or an authorised absence), the alert disappears by itself.
- **Hide for 2 minutes** hides the alerts showing on that screen only; a new alert still appears at once.
- It checks every minute, flashes the browser tab's title, and beeps when a new alert arrives (once someone has clicked on the page; browsers block sound before that).
- Being admin does not give the pop-up; only a role with the grant does. The checks happen in the database.

**"Do you know where this student is?" pop-up on all staff screens** (migration 382, the principal, 6 Oct 2026)

At the same moment the office's pop-up appears, every member of staff signed in to Formwork gets a flashing pop-up: the student's name, photo, year, mentor group and house, and "Please send them to <lesson>, room <room> (<teacher>)".
- Everyone on staff gets it, except the people who get the office pop-up (they have their own) and the person who marked the student absent. Students and parents never see it.
- **I've sent them** (with an optional note of where they were) clears it from every staff screen and shows on the office's pop-up.
- **Not with me** clears it from that person's screen only; the office sees who has said so.
- It stays until the period ends, even after the office has pressed Seen (the office usually presses Seen straight away, which would otherwise take it off everyone's screen before anyone had read it). A corrected mark clears it at once.
- **Hide for 2 minutes**, the beep and the one-minute check work as on the office pop-up.
- Answers are kept (who, when, the note). The checks happen in the database (`staff_missing_student_alerts()`, `respond_missing_student_alert()`).

**Missing a lesson gives an automatic negative** (migration 388, the principal, 7 Oct 2026)

From 8 Oct 2026, a student who was in school that day (marked present or late at any period, before or after) and is marked **absent without a reason** (No reason given or Unauthorised absence) at a lesson, an Other Half activity or Evening Prep gets a behaviour event in **Missing a lesson activity** (−5) for each period missed.
- It is recorded at the end of the lesson: a check runs every 5 minutes for periods that have ended today. A student who skipped Period 1 and is marked present at Period 3 is recorded once the Period 3 mark is saved.
- Registration doesn't count (absent at registration but present later is lateness to school). Authorised absences, including planned absences, never count. A student away all day gets nothing from this.
- At −5 it is a serious event: it gives its own detention, sends the usual behaviour alert, and parents see it only after the office/SMT review, like any Stage 5.
- The event is the school's, not a teacher's: it has no "logged by" teacher, and its writing says which lesson, which code and who marked the student absent.
- If the teacher corrects the mark (to present, late or an authorised absence) or deletes it, the event is withdrawn and its detention cancelled if not yet held. One event per student per period per day, ever: one SMT delete or the review returns isn't made again.
- If the category is retired or renamed, nothing is recorded.
- **The teacher is asked to confirm** (migration 389, the principal, 7 Oct 2026). Whoever saved the absent mark gets an email and a Formwork inbox message: the student, the lesson or activity, the code, the −5 and the detention date, and "Was <name> really not in your lesson?". If they weren't there, the teacher does nothing. If they were, the teacher corrects the register from the link, and the event and detention are withdrawn. Replies go to the attendance officer (changeable at Email Replies).

**Stage 5 "collect from lesson" pop-up on the office's screens** (migration 383, the principal, 6 Oct 2026)

A full-screen flashing **purple** pop-up (purple so it is never confused with the red missed-lesson pop-up), on whatever Formwork page is open, for anyone whose role is granted **Stage 5 collection pop-ups** at Permissions (the school office to start with). It says "Please go and collect this student from their lesson", with the student, the lesson or Other Half activity, the room, the teacher, the period, the category and the teacher's explanation.
- It appears when a teacher logs a Stage 5 (a negative event at or below the serious-event points) for today **while they are teaching that student**: in a lesson running right now that they teach (the lesson's own teacher, or the cover teacher when it is covered), or in the student's Other Half activity running now where they are one of its staff. An event moved up to Stage 5 during the lesson counts too.
- A Stage 5 logged later about something earlier, or by someone not teaching the student at that moment, raises nothing: the student is somewhere else by then.
- The teacher sees "The office has been asked to come and collect the student from your lesson" when they save.
- **During prep it goes to the Head of Boarding** (migration 388, the principal, 7 Oct 2026). A Stage 5 logged today, by anyone, while the student's year group is in prep (one of its prep days, between its prep start and end times at Prep Times, in term, not a holiday or blocked day) gives the same purple pop-up, saying "collect from prep", to everyone holding the **head_of_boarding** role (checked directly; admin is not enough), not the office. Either Head of Boarding pressing **Going to collect** clears it for both. The person logging it sees "The Head of Boarding has been asked to come and collect the student from prep".
- **Going to collect** (with an optional note, e.g. who is going) clears it from every office screen and records who and when. If the event is voided, deleted or stops being a Stage 5 first, it disappears by itself. Unanswered alerts disappear at the end of the day.
- **Hide for 2 minutes**, the flashing tab title and the beep (a different, rising sound) work as on the missed-lesson pop-up; it checks every 30 seconds.
- Being admin does not give the pop-up; only a role with the grant does. The checks happen in the database (`office_stage5_collection_alerts()`, `acknowledge_stage5_collection()`). It never stops a behaviour event being saved.

**Register-not-taken pop-up on teachers' screens** (migration 367)

The same kind of full-screen flashing pop-up, for a teacher whose own lesson today started **at least 10 minutes ago** and has no register yet (five minutes before it reaches Registers Not Done).
- Their lessons are the ones they teach (a lesson's own teacher first) and Other Half activities they are staff on. Same rules as Registers Not Done, except that a day with a holiday on the calendar gives no pop-ups. Planned-absence marks don't count as the register being taken, unless every student in it has a mark.
- It shows the class, room, period and how long ago it started, with a **Take register now** button that opens that register.
- Earlier lessons today stay on it until their register is taken. Saving the register clears it by itself; there is no "seen" button.
- **Remind me in 5 minutes** hides it on that screen; a newly overdue lesson still appears at once.
- It is never shown on the register pages themselves, so it doesn't cover a register being taken.
- It checks every minute, flashes the tab title and beeps when a new lesson is added. Only the teacher's own lessons are shown; the database works out who they are from their sign-in.

**Register alerts** (`/admin/register-alerts`)
- Every 15 minutes, outstanding registers are copied into a permanent alert list: one per lesson per day, and one per OH activity per member of staff per day.
- An alert stays even if the register is taken later. Someone must mark it resolved.
- HR, the school office and admins can see and resolve alerts.

**Bell times** (`/admin/bell-times`, admin only)
- Each weekday has its own sessions and times. With no row for a session, it doesn't run that day.
- Saving a bell time moves every lesson in that period to the new time.
- **One day on another day's times** (373, 5 Oct 2026): at Bell Times a date can be booked to run on another weekday's times (for example a Monday on Friday's shorter times). Every period that runs on both days takes the other day's times for that date and every class's lessons move with them; periods on only one of the days are left alone. Booking today applies at once; otherwise it applies that morning, and the usual times come back at 04:45 the next morning (a time changed by hand that day is left as it is). One booking per date, weekdays only. Cancelling puts the times back at once if it is in effect. Bookings are never deleted. Only those who can edit bell times (admins) can book or cancel.
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

Sunday has Evening Prep only (19:00–21:00, migration 362), so students can change Other Half choices on Sunday evenings. It is on the Bell Times page and can't be made the same as a weekday from there.

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

**Cover for absent teachers** (374, 5 Oct 2026)
- Only SMT arrange or cancel cover (admin alone is not enough), from **Cover** on the Timetable card or **Arrange cover** on someone's timetable.
- Cover is set lesson by lesson for one date, today or later. The absent teacher is taken from the lesson itself, never chosen.
- Only staff who are free then can be chosen: no lesson, meeting or Other Half activity of their own, and not covering something else. The list shows how many covers each person has done this term; someone being covered for elsewhere that day is flagged, not blocked.
- One cover per lesson. The covering teacher gets an inbox message with SMT's note and an apology, and the lesson shows on their timetable for that date only. The absent teacher's timetable says who is covering.
- Covers are cancelled, never deleted (a past cover can't be cancelled). Cancelling tells the covering teacher.
- The class's teacher and register don't change; any member of staff can take any register.
- The register is the covering teacher's job that day (375): Registers Not Done lists the lesson against them, marked "(cover)", the register alert and the overdue banner go to them, and they get the 10-minute pop-up instead of the absent teacher.

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
- Staff can see whether ordering is open on the Tuckshop card of their home page: a green "Ordering open" or red "Ordering closed" badge with when it next closes or opens (2 Oct 2026) **(page only)**. It only reports; the database still decides.

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
- Sell Items can also sell one item to a group (migration 350): load a form, year group, restaurant or student group, tick the students getting it, and only the ticked students are charged, at the item's current price, one purchase each. A leaver among the ticked students stops the whole sale, so nobody is half-charged.

**Hand-out** (`/tuckshop/hand-out`, 228–233, 351)
- Open to the **tuckshop and tuckshop_owner roles only**. Admins and the bursar are shut out.
- Tapping a student marks the order given and charges it. Tapping again (after a confirmation) undoes it and refunds the charge exactly.
- If some items weren't available, staff enter what was actually given, from 0 up to what was ordered. The student is charged only for that, and the original order is kept for comparison.
- **Not collected** (migration 351) marks an order the student never came for. Nothing is charged, and it can be undone until the list is saved. It is kept apart from a cancelled order (withdrawn before the day), so the record shows orders that were made but not picked up.
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

**Behaviour Totals** (migration 361, 4 Oct 2026, `/pastoral/behaviour-totals` on the Pastoral tile)
- Running totals of positive and negative points for a term, the academic year or chosen dates. Net = positives minus negatives. Withdrawn events don't count.
- Mentors see their own mentor group, student by student. SMT, pastoral, head of boarding and admins see every mentor group with its average (net points divided by the number of students in the group, counting students with no events) and can open any group. Both views download as CSV.
- This only arranges what staff can already read: every member of staff can see behaviour events.

**Logging events**
- Any member of staff can log an event. Students and parents can't.
- **Points always come from the category**, and every event must have one. Staff can't type points.
- Only admins set the categories and their points (`/admin/lookups`).
- **An event keeps the points it was logged with** (migration 378, the principal, 5 Oct 2026). Changing a category's points at Lookups applies to new events, and to events moved into that category, never to events already logged, even when their comment is edited. A returned Stage 5 that the teacher keeps as Stage 5 gets back the points it had when it was returned.
- **Categories are retired, not removed** (378). A retired category isn't offered when logging or changing an event's category, but events already logged keep it, can still be edited, and can still be filtered by it; it can be brought back. A category that any event has used can't be removed, renamed or moved to the other type: retire it and add a new one. Only a category no event has used can be removed.
- Negative categories range from −1 (e.g. late to lesson) to −5 (e.g. bullying, academic dishonesty, Stage 5). Positive categories range from +1 to +5.
- **"Logged by" is always the signed-in person**, so nobody can log an event under a colleague's name (138).
- The event's class is worked out from the class the teacher shares with the student (145). Parents see the subject, not the teacher.
- **Serious means −5.** A −5 event can't be saved without a written explanation (166).
- **Choosing Stage 5** (migration 335, 3 Oct 2026, because some staff were using it for minor offences): when a serious category is picked on Log behaviour, a box shows what is and isn't a Stage 5 (the school's guidance, edited at Lookups: violence of any kind, bullying, theft, cheating, leaving bounds, abuse of staff, deliberate damage, a phone outside Sunday after lunch and similar; not lateness, uniform, low-level disruption or repeated minor behaviour, which reaches a detention through the weekly total). The member of staff must tick that it is a single serious incident before saving, and the same applies when an event is edited up to Stage 5. Each category can have a short description, shown when it is picked.
- **Who reviews Stage 5** (migration 336, the principal, 3 Oct 2026): the principal's PA and SMT. SMT review every serious event, with or without a picture; the PA reviews those without a picture through her school office role. The other school office staff don't have the Behaviour Review page.
- **Returning a Stage 5 to the teacher** (migration 335): at Behaviour Review the reviewer (the PA or SMT; only SMT for an event with a picture) can mark a serious event "Not Stage 5" with a note. The teacher who logged it gets the note in their Formwork inbox and sees it on the event. If they change the category, it leaves the review (detentions are adjusted as for any edit). If they keep it as Stage 5 and edit the explanation, it goes back to the reviewer. Only the reviewers can return an event, and only before parents can see it.
  - As soon as an event is returned its −5 stops counting (it counts 0 until the teacher changes it), and its detention is cancelled if it hasn't happened yet, with the week's total detention if the week no longer reaches it; the student is told. When the teacher changes it, the new category's points count (migration 337).
  - Every return is kept permanently against the teacher who logged the event, and Behaviour Review shows SMT a count per teacher, to see who needs more training (migration 337).
- **Reviewers can change any event's category** (migration 376, the principal, 5 Oct 2026): Behaviour Review has an **All events** tab listing every behaviour event (positive and negative, filtered by dates, type, category, year and a search of student, teacher or comment). The reviewers (the PA and SMT, and admin) can change an event's category within its type, and must give a reason. The points follow the new category and detentions are added or cancelled as for any edit; the comment is unchanged. The teacher who logged the event gets the reason in their Formwork inbox (not when the reviewer logged it themselves). Every change is kept permanently, shown on the event in that list, and is also in Change History. Moving an event up to Stage 5 needs the same guidance tick as logging one, and an explanation.
- **Reviewers can cancel an event** (migration 377, the principal, 5 Oct 2026): on the same All events list, a reviewer can cancel an event that shouldn't have been logged (the wrong student, a duplicate), and must give a reason. It is withdrawn the way an upheld appeal withdraws one: it stays on the student's record crossed out, saying who cancelled it and why, its points stop counting everywhere (totals, detentions, reward points) and parents and the student no longer see it. Its detention, and the week's total detention if the week no longer reaches it, is cancelled if not yet held, and the student is told. The teacher who logged it gets the reason in their inbox. Cancelling can't be undone from the app. Deleting an event is still SMT's only.
- **Other students in a serious event** (migration 303, 1 Oct 2026): on a serious event (−5, e.g. Stage 5, bullying), staff can add other students as a **witness**, **involved** or **target**, found with a filter by name, year group and house. This can be done when logging (under the explanation, with the "+ Add a witness, someone involved or a target" button) or later from the event. Anyone who can edit the event can add, change or remove them. All staff can see them; **students and parents never do**, so the explanation still mustn't name anyone. Being added gives a student no points, detention or alert. Changes are logged in Change History.
  - **Parents never see these names** (304): once an event can be seen by parents, its explanation can't name any of the other students (first, last, preferred or legal names, whole words). The database refuses to release it, edit it to add one, or link a student it already names, and says which word to reword. A name the event's own student shares (e.g. a sibling's surname) doesn't count.
- Staff can attach one picture per logging, on positive events only (migration 297, the principal, 30 Sept 2026): the picture field is hidden for negative events and the database refuses a picture on one. Pictures are shrunk in the browser and must be under about 150 KB.

**Editing and deleting** (207, 208, 211)
- The teacher who logged an event can edit it, and so can pastoral, houseparent, head of boarding, SMT, school office and admin.
- Only the comment and the category can change, and the category must stay the same kind (negative stays negative).
- Detentions are recalculated after an edit that changes the points (a change of category).
- Events withdrawn on appeal can't be edited.
- Only SMT can delete an event, a merit included (migration 319, the principal, 2 Oct 2026). Holding the smt role is what counts; an admin login alone is not enough. Staff can't withdraw an event or move it to another student any other way; withdrawing is done only by an upheld appeal or a reviewer cancelling it at Behaviour Review (377).
- Changes and deletions are logged in Change History.

**What parents see**
- **Any event with writing in it is approved before it goes home** (migration 387, the principal, 7 Oct 2026), positive or negative. Until it is approved parents see nothing of it, points included. A merit with no writing still goes to parents at once.
- **Negative events are hidden from parents until reviewed** at `/behaviour/review` (238, 239):
  - Events with a picture: SMT or admin decide. They can send the text with the picture, send the text only, or decline.
  - −5 events without a picture: the principal's PA (through her school office role), SMT or admin release the text (SMT since migration 336).
  - −1 to −4 events with writing: approved like merits with writing (below), and go home once sent (387). Without writing they never go to parents.
- **Merits and −1 to −4 events with writing** wait under "Writing to approve" on Behaviour Review, for the school office (the PA), SMT or admin (SMT for one with a picture). The reviewer can correct a comment, tick many and send them together after confirming they follow protocol, name no other student and are in good English, or keep them at school, in which case parents never see them.
- **Changing the writing sends it back for approval** (387): if anyone edits an event's comment, even after it was sent, parents stop seeing the event until it is approved again.
- **The review is the only way an event with writing, or a negative event, reaches parents** (305, 387): staff can't make an event visible to parents, mark it reviewed or change its type directly, and a new negative event, or one with writing, always starts hidden.
- Students still see their own events, with the writing, straight away.
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
- Statuses are scheduled, attended, missed and cancelled. Whoever has the `/detention` page can mark them attended or missed (240), but **only SMT can cancel one** (319, the principal, 2 Oct 2026). The date and student can't be changed. Detentions still cancel automatically when an event's category is corrected below the thresholds or an appeal is upheld.
- **The student** (not parents) gets an email and a Formwork inbox notice when a detention is booked, a reminder at **7:30pm on Thursday**, and a notice if it is cancelled. Replies go to SMT.

**Reward Store** (migration 370, the principal, 5 Oct 2026; design in `docs/reward-store-design.md`)
- Students spend merit points on rewards from the **Reward Store** tile on their portal (shown only while the store is open; it was closed with every reward retired on 5 Oct 2026 until the principal adds more). To begin with: Mufti day (40 points, once a half term), Extra tuckshop visit (25, once a fortnight) and Assistant for a day (100, once a term, one student a day across the school).
- **The merit total doesn't change.** Spending is kept separately, so certificates, Behaviour Totals and reports count every merit as before. Points to spend are this school year's merits (from 1 Sept 2026) less what the student has bought; negative points don't reduce them. They start again each September.
- Points are taken when the student buys, and come back if the request is declined or cancelled. A student can cancel their own request until it is decided. If a merit is later removed, points to spend can drop below zero; nothing is taken back, but the student can't buy until it is above the price again.
- Each reward has a day rule (mufti and assistant: a school day, Mon–Fri in term, not a holiday; tuckshop visit: any day in term), chosen up to 28 days ahead, plus its limits. "Half term" splits a term at its mid-term break in the calendar.
- **Who approves:** set per reward. Mufti: pastoral or head of boarding. Tuckshop visit: the tuckshop. Assistant for a day: SMT, who choose the member of staff the student will help. Admins can approve any reward. Nobody can decide a request for their own child. Approvers can also cancel an approved reward (with a reason) and mark it used from its day onwards. The student gets an inbox message for each decision; for an assistant day, so does the member of staff.
- **The Rewards card** on the staff dashboard (migration 371, the principal, 5 Oct 2026) holds **Orders** (`/rewards`: accept or decline students' orders, cancel, mark used, and a printable day list, e.g. who is in mufti; SMT, pastoral, head of boarding and the tuckshop), **Rewards & Prices** (`/rewards/items`: rewards, prices, limits, who accepts each, the store open or closed; SMT and pastoral) and **Certificates** (moved from the Pastoral card). The card shows how many orders are waiting for you to accept. Who can change rewards is set by the Add and Edit ticks on `reward_items` at `/admin/permissions`. Rewards are retired, never deleted; requests are declined or cancelled, never deleted. A price change applies only to later purchases.
- Every change is logged in Change History under "rewards". Parents don't see purchases yet (stage 2); assistant days aren't yet recorded in attendance (stage 3).

---

## 9. Assessment, results and reports

**Entering scores** (`/results/enter`)
- A teacher can enter or change scores only for students in their own classes, in that class's subject (129).
- A Head of Department can enter or change scores in their department's subjects, the same rule as deleting them (321, the principal, 2 Oct 2026). A subject with no department stays with its class teacher and the assessment staff.
- Assessment managers and admins can enter or change any score. Assessment users can too, but can't delete.
- Scores are percentages (0–100). The grade is worked out from the subject's boundaries for that year group when the score is typed, and saved with it. Changing boundaries later does **not** regrade saved scores.
- Only the current school year's result sets can be picked for entry **(page only)**.
- There is one score per student, per subject, per result set.

**Deleting a score** (236)
- The class teacher can delete their own students' scores.
- A Head of Department can delete scores in their department's subjects.
- Assessment managers and admins can delete any score.
- Where: Enter Results (pick the class and result set), or, for assessment managers and admins, the **Delete** button beside each score on a student's profile (Results tab), which saves finding the class first.
- Assessment users can't delete.

**Appealing a mark** (354, the principal, 4 Oct 2026, because wrong numbers were being entered)
- A student can appeal one of their own marks, in any result set, within **5 days** of it appearing or last changing (a re-import that changes nothing doesn't reopen it). They give a reason and, if they like, the mark on their paper. Students only; parents can't appeal.
- Each student has **5 appeal credits a school year**. An appeal that is turned down uses one; an upheld or withdrawn appeal gives it back. A waiting appeal holds a credit, so a student can't have more appeals open than credits left.
- One appeal per mark at a time; once decided, a mark can be appealed again only if it changes.
- **Only the student's teacher for that subject decides**, at Mark Appeals (`/grade-appeals`, Assessment card), after checking the paper. Upheld: the teacher enters the correct score, the grade is worked out from the boundaries, and the change is in Grade History under the teacher's name. Turned down: the teacher must give a note, which the student sees. Teacher and student are told in their Formwork inbox, and the teacher is also emailed, with the subject's Head of Department in cc (357; replies go to the Mark appeal row at Email Replies, sro@ to start). The subject's Head of Department gets a copy of each new appeal, saying which teacher it has gone to (355), and of the decision: who decided, the old and corrected mark or that it stands, and the teacher's note (356); they can follow their department's appeals on Mark Appeals but can't decide them.
- A student whose subject has no teacher in Formwork can't appeal (they're told to see their mentor).
- SMT, assessment managers and admins can see every appeal, and Heads of Department their department's, but none of them can decide. Appeals are never deleted.
- The 5 days and 5 credits are set per school year on Lookups (`/admin/lookups`, Mark appeals, 355), by anyone with that page. Changing them doesn't affect appeals already made.
- Not handled: an appeal waits until the teacher decides; nobody else can step in if the teacher is away or has left.

**When parents see a mark** (360, the principal, 4 Oct 2026)
- Parents see a mark only once it is a set number of hours old, counted from when it was first entered. This gives a teacher (or the student, through an appeal) time to put a wrong number right before families see it.
- The number of hours is set on Lookups (`/admin/lookups`, When parents see marks) by anyone with that page, from 0 to 168 (a week). It starts at **0**, which means parents see marks as soon as they are entered.
- It covers every mark parents see: ReLPs, Teacher Assessments and all other results.
- A correction doesn't restart the clock, so a mark a parent has already seen stays visible after it is fixed. The time a mark was entered can't be changed from the app.
- Students and staff see marks at once. Staff who view the parent portal (including staff who are also parents) see every mark straight away, because they can see all marks as staff.

**Every grade change is logged permanently** in Grade History (215)
- This covers every insert, change and delete of scores, target grades, transcript grades and homework grades, with the old and new grade and who did it.
- Nobody can edit or delete the log, even from the database editor.
- It is readable by SMT, assessment managers and admins at `/assessments/grade-history`. Homework grades and student group marks in it are readable by SMT and admins only, not assessment managers, and are hidden unless "including homework and group marks" is chosen (278, 287).

**Result sets**
- A result set is a calendar event with the "result set" box ticked. SMT and admins manage the calendar (205).
- Missing Grades (`/results/missing`) lists, class by class, who still has no mark. A subject is only expected if someone in that year group has a mark for it.

**Special result sets** (358, the principal, 4 Oct 2026; e.g. Year 12 mocks)
- On the calendar, choosing the **One Year** category (359) and ticking the year groups makes a special result set. One Year events are always result sets, and the database keeps the category and the year groups together.
- Only students currently in those year groups can be given a mark in it. Enter Results lists only their classes and students, and the database refuses anyone else. A mark can still be corrected after the student moves up a year.
- Its marks are kept under its name, not in a week: on the Termly Grade Report the set **replaces the week column its date falls in**, headed by its name (e.g. Year 12's "Wk4" becomes "Y12 Mocks"; the principal, 4 Oct 2026), and it doesn't count towards that week's weekly assessments. Students in other year groups see that week as usual. The written report includes it like any other mark in the term.
- **It never goes on a transcript**: a special set can't also be an end-of-term exam set, and transcripts read only those.

**End-of-term exams** (246, 247, 252)
- There is one result set per year group per term, going back to 2017.
- Year 12 has Terms 1 and 2 only, because Term 3 is WAEC.
- Historic grades were loaded into these sets.

**Grade boundaries, aliases and key stages**
- **Only assessment managers can edit grade boundaries** (the principal, 3 Oct 2026, migration 329); everyone signed in can read them. Admins can change who edits them at /admin/permissions. **Any member of staff can edit subject aliases and subject key stages** (the school's decision, 27 Sept 2026). Boundary changes are not logged.
- Boundaries are set per subject and per year group. Year 12's boundaries are also used as the WAEC boundaries for Years 10–11 on transcripts.
- **Years 10–11 follow Cambridge IGCSE's June 2026 grade thresholds** (migration 322, the principal, 2 Oct 2026) in Mathematics, English, English Lit, Biology, Chemistry, Physics, Computing, Economics, French, Spanish, Chinese, Further Maths, Art, Food and Nutrition, PE, Geography and History: the time-zone variant 3, Extended route (sciences with the alternative to practical), English with coursework, each threshold turned into a percentage of the route's total. Below the lowest grade is **U**. Extended Maths and Further Maths (Additional Mathematics) go down to E only. Other subjects, Years 7–9 (90/80/70…) and Year 12 (WAEC) are unchanged.
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

**Homework** (278, 279, 291, 295–296, 352–353; Years 7–12 from 4 Oct 2026, `/homework`)
- **Which classes:** homework can only be set for classes an admin has switched on. Since 4 Oct 2026 (353) that is every teaching group in Years 7–12; mentor groups, Prep and Year 12's Personal Study are not included (from 30 Sept it was Years 10 and 11 only, 295). A new class (from a later timetable import, or next year's classes) is switched on automatically, unless it is one of those (296, 353). An admin can still switch a class off. Teachers, Heads of Department and SMT have the `/homework` page. A teacher's own classes are shown as buttons; a drop-down holds the other classes in the subjects they teach, which they can open to see what colleagues have set but not edit or see grades, and any classes they manage as Head of Department or admin.
- **Who can set, edit and mark it:** the class teacher, the teacher of any single lesson of the class, the Head of Department for the subject, and admins.
- **Where it's set:** from the class register (`/attendance`), where a Homework panel appears for classes the teacher can set homework for, or from `/homework`, which also has the mark books.
- **Setting it:** each piece of homework has a title (at most 10 characters, so it fits the mark sheet; 290), instructions (plain text), a deadline (a date, and optionally the lesson it's due in, which must be one of the class's lessons that day) and a grading system: Mark out of …, Percentage, A*–U, 9–1, WAEC, Effort 1–4, Complete / Incomplete or Not graded. Any grading system also accepts "Not handed in" and "Excused".
- **Time and prep evening** (352, 4 Oct 2026): every homework says how long it should take (5 minutes to 4 hours; 30 minutes unless the teacher changes it). It is done in prep on **the evening before its deadline** (the year's last prep evening before it, in term and not a holiday: Sunday for a Monday deadline), worked out by Formwork, so homework set weeks ahead still lands the evening before it is due. It can't be saved if that evening has already passed, or if **any student in the class** wouldn't have that much homework time left that evening once their other homework for it (from any class) is counted; the message names the students who would run out of time. The form shows the evening and the least time any student has left. A student's homework time comes from **Prep Times** (`/pastoral/prep`, admins, SMT, pastoral and head of boarding): prep from 7.00 pm to 9.15 pm for Years 7–9 less their first hour reviewing the day's work (75 minutes), 7.00 to 9.45 pm for Years 10–12 (165 minutes), Sunday to Friday. A year can also count its timetabled Personal Study lessons (meant for a future Year 13; no year does yet). Changes to Prep Times are in Change History and don't move homework already set. Prep Times also lists **days with no homework** for a year (353; mock exams, trips): nothing can be due that day for that year and its evening has no homework time, so homework goes on the prep evening before. The first were Year 12's mocks on Thursday 8 and Friday 9 October 2026. Homework set before 4 Oct 2026 counts as 30 minutes on the evening before its deadline, and editing its title or instructions doesn't re-check it. Students see each homework on their Homework page under the day it's to be done ("To do"), as well as on its deadline. **A student can move it to an earlier day** for their own planning ("I'll do it on…", from today up to the day before its prep evening, or back). Once the homework is graded it goes back to its prep evening and shows the grade there. That changes only their own page: the homework stays on its prep evening for the teacher and the time check, and staff don't see students' plans.
- **Grades:** a grade must fit the grading system (a mark between 0 and the maximum, or one of the list's grades). A mark is converted to a grade from the subject's grade boundaries for the class's year group (289): 11 out of 14 is 79%, which is a B. The database works out the grade; a percentage between two bands takes the lower one. Changing a boundary later doesn't regrade saved homework marks. A grade can only be recorded for a student in the class. Once any grade is recorded, the grading system can't be changed and the homework can't be deleted, only withdrawn.
- **Mark sheet:** on `/homework`, each class has a mark sheet: one row per student and one column per homework due between two dates (the current term by default). Each column is headed by the title and the due date. It shows each student's average of their number-marked homework, with its grade from the subject's boundaries, how many were marked and how many weren't handed in, and it downloads as CSV. It shows only what the person may already see.
- **Who sees grades:** the class's teachers, the Head of Department, SMT and admins. Other staff (mentors, pastoral, assessment managers) can see what homework was set but not the grades.
- **Marks follow the student** (291): if a student changes class or teacher, whoever teaches them in that subject now can see all their homework marks in it for this school year, from any class. The teacher who gave the marks still sees them too.
- **Joining a class late** (298): Formwork records the day a student joins each class. Homework due before that day is not shown to them and they are left out of its mark book and the mark sheet, unless they already have a mark for it. Students already in a class on 1 Oct 2026 count as joining on 1 Sept 2026.
- **Student view:** on `/homework`, staff can open any class they can see there in "Student view", which shows that class's week of homework exactly as its students see it, without any student's ticks or grades.
- **Homework Monitor** (311, `/homework/monitor`, a tile on the staff dashboard's second row; SMT and admins): homework as students see it. For a year group, every class's homework due in a chosen week on the students' cards (filterable by subject), with a table of each subject's switched-on classes and which have nothing due that week. Each card shows how far its marking has got rather than the student's "Overdue": *Not marked* (red, once past its due date), *Marked 5 of 18* (amber) or *Marked* (purple; "not released" if students can't see the grades yet), counting the class's current students who were in it by the due date, with Not handed in and Excused counting as marked; the table lists the classes with past-due homework not fully marked (2 Oct 2026). For one student in that year, their timetable with homework on it and their Homework page, exactly as they see it: their own Done ticks and their grades once released, under the same rules as the student's own page. Nothing can be changed from it.
- **Students** see their classes' homework on their timetable (on the lesson it's due in) and on a Homework page laid out by day. They see their **own** grade and comment only after the teacher releases the marks, and only for the current school year.
- **Files and links** (281): the teacher can attach files (PDF, Word, PowerPoint, Excel, OpenDocument, images, text or CSV, up to 20 MB each) and `https://` links to a homework. The same people who can set it can add or remove them. Anyone who can see the homework can open them: all staff, and students in the class while it is set. Files are private and open through a link that lasts ten minutes. Students can't upload anything yet.
- **Ticking done** (288): a student can tick their own homework as done, and untick it, until a grade is released. It is their own note, not a hand-in or a grade. The class's teachers, the Head of Department, SMT and admins see how many students ticked each homework on the homework list and the register's Homework panel, and each student's tick in the mark book. Nobody else does.
- **Colours on the student's screens:** red is overdue or not handed in, amber is due today, green is ticked done (the card shrinks to just the subject), purple is graded.
- **Parents** see nothing about homework except the Homework grade on the published written report.
- **Reports** (291): while writing a subject comment, the teacher sees each student's homework this term in that subject (from any class): average, grade, how many were marked and how many weren't handed in. The Homework judgement is suggested from the average (80% and over Excellent, 60–79 Good, 40–59 Satisfactory, under 40 Needs Improvement); the teacher can change it. Checkers see the same figures. Every mark recorded for homework due that term counts, whether or not released to students; Not handed in is counted separately, not as zero. The printed report shows Homework as the grade of the average only (e.g. B), never the percentage; a subject with no homework marks shows the teacher's judgement. Transcripts, result sets and target grades still never use homework.
- **No notifications:** setting homework or releasing marks sends no email or inbox message.

**Reading ages** (323, 2 Oct 2026; `/reading-ages`)
- A reading age is kept in years and months, with **the date it was tested**. The gap is the reading age minus the student's actual age on that day (from their date of birth): **negative means reading below their age**. The gap is worked out whenever it is shown, so correcting a date of birth corrects every gap.
- **Where readings come from:** the test taken when a child applies (entered on the New application form or the applicant's Details, with the date tested) and the paper test at the admissions interview (entered in the applicant's Interview section); both appear in the student's history once the applicant is enrolled; the school's own tests (entered at `/reading-ages/record`) and NGRT (imported; none since January 2023, and only today's Year 11 and 12 have any).
- **Recording a test** (`/reading-ages/record`, also on the Assessment card): a test name and the usual date for a year group or form, a reading age per student; students left blank are skipped. A student who sat it on another day gets their own date on their row (324). One reading per student, per date, per test; saving again updates it. A test can't be dated in the future. Teachers, assessment managers, Heads of Department, SMT, the school office and admins can record, correct and remove school tests (teachers from 2 Oct 2026, 324; the school office ticked at `/admin/permissions` by 6 Oct 2026). Clicking a student's name shows their full name and Admitted/letter date, and students saved during a visit drop off the list until "Show them" is pressed (6 Oct 2026, page only). Application, interview and NGRT readings are corrected where they were entered.
- **Seeing the tracking** (`/reading-ages`): teachers, Heads of Department, mentors, pastoral, assessment managers, SMT and admins. For the whole school, a year group or a form: how many are tested, the average latest gap, how many are reading below their age (in bands: 2+ years below, 1–2 years below, up to a year below, at or above), how many have closed the gap since their first reading, the average gap at each sitting (term, or school year for older readings), and each student's first and latest reading with the change. Each student's readings are also on their profile (Reading Age tile) as a chart of reading age against actual age.
- All staff can read reading ages, as they can NGRT. **Parents** see their own children's (still at the school) on the parent portal's Reading Age tile: each reading's date, test, reading age, age on the day and gap, with the chart (324, the principal's decision). **The tile appears only once a child has two readings from the school's tests or the admissions interview** (old NGRT sittings don't count towards the two, but are shown once it appears); before that parents see nothing (325, 326). **Students** see none.
- Every school test added, changed or removed is logged in Change History under "Reading ages", with who did it.

**Lesson feedback** (365, 5 Oct 2026; `/lesson-feedback`)
- **Students** give feedback on a lesson from their timetable: a "Give feedback" button on the lesson, and a list of open lessons above the timetable. They choose **green** (understood it and could do the work alone), **amber** (understood some of it) or **red** (didn't understand, need help), then answer Yes or No to each question. Every question must be answered. There is no comment box.
- **When:** from the end of the lesson until the end of the next day, once per lesson, and it can't be changed once sent. Only teaching lessons (not Mentor, Prep, Personal Study or the Other Half), in term and not on a holiday, in a class the student had joined. A student marked absent for that lesson can't give feedback; if the register hasn't been taken yet, they can.
- **The questions** are listed at Lookups ("Lesson feedback questions"): ten to start (started on time, knew what to learn, pace about right, too easy, too hard, bored, could explain the main idea, got help when needed, classroom calm, book marked). Each says whether Yes or No is the good answer, or neither. Questions can be added, reordered or retired; once students have answered one, its wording can't change (retire it and add a new one instead). Retired questions keep their answers.
- **Teachers never see names.** On Lesson Feedback (Students card: teachers, Heads of Department and SMT) they see a summary for each class they taught, for the dates they choose, grouped by department and then teacher (each opens and closes; its row adds up the classes beneath, counting only classes whose figures are shown): how many responded, the green/amber/red split and the share answering Yes to each question. Heads of Department see their department's classes the same way. **A class's figures are shown only once it has at least 3 responses in those dates**, so one student's answers can't be picked out.
- **SMT** see the summary for every class and also the **named responses**, by default only students who were red, so someone can follow them up. Admins without the SMT role don't see names.
- **Parents** see nothing. No emails or inbox messages are sent.

**Certificates:** these are behaviour-points certificates. See the gap in [§14](#14-known-gaps-and-inconsistencies-found-while-writing-this).

---

## 10. Pastoral, boarding, clinic and HR

**Houseparents and head of boarding**
- Houseparents' student and behaviour pages default to their own house. Houseparents with other school-wide jobs get a "Whole school" switch. This is a display filter only.
- The head of boarding has houseparent powers across all houses and counts as pastoral for detentions, appeals and editing events (224).

**Mentors:** a mentor's students are the students in their mentor-group class (127).

**Clinic** (128–130)
- Covers medical records, conditions, the sick-bay log, immunisations, BMI and resumption screenings.
- **Only the nurse and the Designated Safeguarding Lead (`dsl`, 363) can see any of it.** The nurse can view, add, edit and delete; the DSL can view, add and edit (no delete). Admins, the principal role, teachers, pastoral staff, students and parents have no access. This is padlocked at `/admin/permissions`: it changes only by a migration the principal agrees (4 Oct 2026). cs@ holds `dsl`.
- **Safeguarding entries (364).** A DSL can mark a sick-bay log entry as safeguarding, when recording it or later. The presenting complaint and observations are then visible to the DSL only; everyone else, the nurses included, sees "Safeguarding: details held by the DSL". Medication, dose, treatment, temperature, outcome and the rest stay visible to the nurses. Only a DSL can set or remove the mark (removing it puts the description back); who marked it and when is recorded.

**Staff HR records** (`/staff/records`)
- HR and SMT can read them. Only HR (and admin) can edit.
- Nationality must be Nigerian, British or Other.

**Birthdays** (`/pastoral/birthdays`)
- Shows the next 7 days of birthdays to admin, SMT, pastoral, houseparent and the school office.
- Today's names are shown to staff and students after they sign in, never to parents.

**Unallocated Students** (`/pastoral/unallocated`)
- Lists active students with no boarding house, no boarding room, or a gap in their week. Admin, SMT, pastoral, houseparents, the head of boarding and the school office can see it.
- A period only counts as a gap when others in the same year group have something then (a lesson, Evening Prep, or an Other Half activity open to their year this term), so free periods a whole year shares aren't listed.

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

**Budget: where fee money belongs (being built; the principal only for now)**
- Every fee item pays into one **fund** (cost centre). Tuition and discounts go to the **general fund**; damages to Maintenance; swimming, sports, medical, ICT and exam entries are **ring-fenced** for what they were charged for; tuck shop money is the students' own and stays outside the budget.
- When a payment is recorded the system shares it between the funds on that invoice **in proportion to what each is still owed** (the principal's rule). A tuck shop top-up made from a payment is paid first. Anything paid beyond what the invoice owes is held as credit in the general fund and moves to the right fund when the charge is added. The share is stored, so later charges don't move money collected earlier.
- Only the principal or the college secretary can add, rename or archive cost centres, or choose which fund a fee item pays into. Once an item has been charged its fund can't change. Cost centres are never deleted: archiving records who did it and when.
- **Fees are termly.** New fee items in the tuition, activity, technology, medical or exam categories are locked to their approved price, like the existing ones, so they can be given a different approved price for each year group (proposed at Fee Items, approved by the principal and the college secretary) and can't be charged at any other amount. The term forecast shows each year's price where they differ.
- **Fees by year and term:** a fee can have its own price for each year group in each term (for example Year 12 paying Terms 2 and 3 together in Term 2, and nothing in Term 3). These prices apply only once the principal and the college secretary have both approved them, and the bursar can then charge only those prices for that term. Where a term has no list, the fee's year price (or single price) applies.
- **Discounts and bursaries** are flagged once on each student (a bursary is a percentage off tuition). The term forecast counts how many students in each year have each one. Students who look like a 3rd (or later) child, from their siblings at the school, are suggested at Discounts for the bursar to confirm.
- **Adding a fee** is one numbered form at Fees & Bills → 1 Fees: (1) what the fee is, (2) which fund it pays into (the principal or the college secretary only; otherwise they choose it later), (3) which terms it is charged in, (4) its prices (for a locked category, a price per year group, per term when it is charged in chosen terms; a year left blank doesn't pay it), (5) send for approval. The prices still apply only once the principal and the college secretary have both approved them.
- **Fees charged in some terms only:** a fee is charged every term unless it is set to chosen terms (for example a WAEC exam fee in the January term only). It can't be charged in any other term, the Charge page offers it only in its terms, and the term forecast leaves it out of the others. The terms can be changed at 1 Fees.
- **The Fees & Bills tile is numbered in the order the work is done:** 1 Fees, 2 Approve, 3 Discounts, 4 Charge, 5 Payments, 6 Accounts, 7 Debtors, 8 Audit, 9 Admissions, 10 Summary.
- **Term forecast:** for each term the Budget page works out the amount available before anything is invoiced: for each fee and year group, the number of students paying × the approved price. The numbers start from the current number of active students in each year (compulsory fees: everyone; school fees: everyone on the full fee; optional activities: nobody), and the principal or the college secretary can change any of them for that term. Current discounts are taken off.
- The budget has its own big **Budget** tile on the dashboard, with a link for each part: Term forecast, Fee income by fund, and Funds & cost centres.
- **Term budget:** each term's money is shared across the cost centres (Staffing, Power, Food, Maintenance, the ring-fenced funds and Contingency). A budget applies only once the principal and the college secretary have both approved it.
- **Requisitions:** any member of staff raises one; the principal signs it; the college secretary costs it with an approved supplier and approves it, which commits the money; whoever asked for it records the delivery; the bursar pays it, never more than the approved total. Nobody signs or approves their own. A requisition that would take its cost centre below zero waits until the principal releases the shortfall from Contingency. Real requisitions can only be approved up to the cash collected for the term.
- **Suppliers:** requisitions can only use approved suppliers, approved by the principal and the college secretary together; changing a supplier's bank details sends it back for approval.
- **Nothing in the budget is deleted:** budgets, requisitions and releases are cancelled, suppliers archived, always with who did it and when.
- **Practice entries:** while the budget is being shown, entries can be marked practice. They never count in real totals, the principal can do every step to demonstrate, and they are cleared in one recorded step before go-live.
- While it is being built, only the principal and the college secretary can see the Budget tile, its pages or its figures (being admin is not enough; the college secretary since 5 Oct 2026). The bursar and SMT don't see it yet. Allocations, requisitions and spending come in later phases (design in `docs/finance-budget-design.md`).

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
  - **reading ages:** school reading tests added, changed or removed (323).
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
5. **`/behaviour/review` page access** is given to admin, HR and SMT, but not the school office, even though the office reviews −5 events without pictures. *Decided (the principal, 3 Oct 2026): only the PA and SMT review Stage 5, so the rest of the office don't need the page; migration 336 let SMT release and return events without a picture.*

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
