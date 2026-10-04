<!-- Snapshot of the living doc "Formwork — Product Requirements (PRD)": https://claude.ai/code/artifact/d7ffd5d9-797b-4db0-b4b9-01f122498f7b
     The living doc is the master; edit it there, not here. This file is re-exported
     whenever the doc is updated (see .claude/skills/update-docs/SKILL.md). -->

# Formwork — Product Requirements (PRD)

Sep 30, 2026 · @Chris TERRY

## Summary

Formwork already runs the school's daily life. The next phase is to make it trustworthy at the edges, by fixing the 29 known issues still open, and to carry it through a whole school year, from admission to year-end rollover, without anyone rebuilding data by hand.

**Where the data came from.** Adorable British College has about 260 students in Years 7–12, many of them boarders. Formwork's data came from SIMS. Enough was extracted to run a working system, but it is a subset, not a full copy:

- **Not exported from SIMS:** its history of changes, and records of students changing class or subject choice. Formwork's history of changes starts from the import.
- **Never in SIMS:** medical details. SIMS wasn't designed for them, so the clinic's records start in Formwork.
- **Held elsewhere:** tuckshop records, on a separate system.
- **Fees:** the bursar calculated fees on a spreadsheet and imported them into SIMS to send out. Payments were traced by the bursar and the office, not through SIMS.

**Where it stands (30 Sept 2026).** Formwork is live at misform.work for staff, students and parents. It covers:

- students, parents and portals
- the timetable and registers
- The Other Half
- behaviour and detentions
- assessment and reports
- the tuckshop and fees
- the clinic, HR and messaging
- the first stage of admissions

Its rules live in the database, and every sensitive change is logged. What it does today is set out in the [Formwork — Functional Specification](https://claude.ai/code/artifact/659cca3b-399b-425f-bb5f-8b23577d5714).

How staff, students and parents use it, role by role and page by page, is in the [Formwork — User Manual](https://claude.ai/code/artifact/419e765d-009a-414f-9da4-d81b2dd75894).

**What this PRD asks for:**

1. Fix what is broken or weaker than it looks.
2. Finish admissions, so an accepted applicant becomes a student without retyping.
3. Build the year rollover, so September 2027 starts on the right classes, forms and timetable automatically.

## Goals and non-goals

The goal of this phase is one continuous student record, from enquiry to leaving, that the school can trust without checking it by hand.

**Goals**

1. **Trust.** Every rule a page shows is also enforced by the database, and every known issue is either fixed or deliberately kept.
2. **Admissions to enrolment.** An accepted applicant becomes an incoming student, with an admission number, parents and a login, in one step.
3. **Year rollover.** Next year's forms, classes, timetable and student places are planned in Formwork and switched over automatically the evening before Term 1.
4. **Less admin.** Staff stop re-keying data that Formwork already holds, such as class lists for Nova-T and applicants into students.

**Non-goals for this phase**

- Replacing Nova-T as the timetabling tool. Formwork keeps importing from it.
- Online fee payment or a payment gateway. Payments stay recorded by the bursar.
- Parent-initiated actions beyond reading: no parent appeals, tuckshop orders or form submissions.
- A native phone app. The web app stays phone-first.
- Bringing back the demo or training account.

## Users and what they need

Most staff use Formwork from a phone between lessons, so each task must take a few taps and never depend on remembering a rule.

| User | Roughly how many | What they need most | Pain today |
| --- | --- | --- | --- |
| Principal and SMT | 4–6 | One view of the school; approve fees; review behaviour before parents see it; plan next year | Rollover and enrolment are still manual |
| Teachers and mentors | about 50 | Registers, scores and behaviour in seconds; write reports | Gradebook import is broken |
| Pastoral and boarding | about 10 | Know where a child is and how they are doing; detentions and appeals | Holidays still raise "register not done" alerts |
| Assessment staff | 2–3 | Clean results, targets and transcripts | Subject settings don't save for them |
| Bursar and college secretary | 2 | Correct charges, payments and approved prices | Tuckshop top-ups leave invoices showing unpaid |
| School office and attendance officer | 2–3 | Student and parent records, logins, releasing serious behaviour; finding students who are missing from a lesson | Only the principal's PA reviews Stage 5 (with SMT), by design |
| Admissions | 1–2 | Track applicants, send letters, and see how many places are left next year | No step to turn an applicant into a student |
| Tuckshop staff | 2–3 | Hand out orders quickly and correctly | Works well today |
| Nurse | 1 | Private medical records and sick-bay log | Works well today |
| Students | about 260 | Timetable, grades, tuckshop, Other Half choices | Works well today |
| Parents | about 1,000 logins | See their child's progress, behaviour, fees and documents | Only what is released or published |

## What is live today

15 of 18 areas are complete for daily use (homework for every year since 4 October 2026); admissions and year setup are part-built; budgets and requisitions are a working draft only the principal sees. Full detail is in the [functional specification](https://claude.ai/code/artifact/659cca3b-399b-425f-bb5f-8b23577d5714).

| Area | State | What it does | Open issues |
| --- | --- | --- | --- |
| Sign-in and accounts | Live | Formwork-made logins only; Google for staff and students; leavers locked out; parent welcome letters sent by admins or the school office, and resendable to reset a forgotten password; a Forgot Password page in the sign-in style, aimed at parents | 1 |
| Students, parents, portals | Live | Field-level edit rights; parents see current children only; siblings found through shared parents; relationship recorded per child; gender required; only the school office adds new students; the Students list searches names as you type; who added each student and every change to a student record are logged; names are tidied of stray spaces; the office is warned when a new parent's email is already on record and offered the existing parent instead | 1 |
| Timetable and imports | Live | Nova-T import with preview; lesson-level teacher and room; the school office can save class allocations | 0 |
| Registers | Live | Any staff marks any register; 15-minute not-done alerts; a Missed Lessons list of students in school who missed a lesson, and a pop-up on the office's and the new attendance officer's screens 15 minutes into a lesson when a student seen earlier is marked absent; planned absences give a student one code (illness, holiday, exclusion and so on) over a run of days, filled into every register without overwriting a teacher's mark | 2 |
| The Other Half | Live | Choices only in Evening Prep; capacity and year checks; a student group can be placed in an activity by the school and locked, until unlocked or a date | 5 |
| Behaviour and detentions | Live | Points from categories; automatic Friday detentions; parent release review; who logged each event shown everywhere, including a student's profile; pictures on positive events only; witnesses, others involved and targets recorded on serious events, staff only, their names kept from parents; release to parents only through the review; only SMT can remove an event (a merit included) or cancel a detention; Stage 5 guidance and a confirmation tick when a serious event is logged, a description for each category, and the reviewer (the principal's PA or SMT) can return a wrongly graded Stage 5 to the teacher, which stops its points counting and cancels its detention at once, with every return counted per teacher | 4 |
| Assessment and results | Live | Own-class entry; grade history log; exam sets back to 2017; assessment managers delete a wrong score from the student's profile; Class Progress is a top-row tile for Heads of Department (their department) and SMT (every class), and teachers see only their own classes in it; it loads quickly because the database picks one grade per student and subject; Heads of Department enter and change scores in their department's subjects; Years 10–11 graded on Cambridge IGCSE's June 2026 thresholds; reading ages recorded with each test's date and tracked against each student's age, by year group and form and over time, with parents seeing their own children's once there are two school or interview readings (literacy target); students can appeal a mark that doesn't match their marked paper within 5 days (5 credits a year, used only by an appeal turned down), decided by their teacher, who is emailed with the Head of Department in cc | 4 |
| Homework | Live | Set from the register or /homework, with files and links; marks converted to grades that follow the student across classes; the term's homework suggests the report's Homework judgement and prints as a grade on the written report; a class mark sheet over any dates; a student view for staff; a Homework Monitor where SMT see a year group's or one student's week as students see it, and how much of each past-due homework is marked; late joiners don't inherit earlier homework; each homework says how long it takes and goes on the prep evening before its deadline, and can't be set if any student in the class would run out of that evening's prep time (Prep Times under Pastoral); students can move it to an earlier day for their own planning, and once graded it shows its grade on its own card where it was; on students' timetables, where students tick it done; days with no homework for a year (mock exams) kept on Prep Times; every teaching group in Years 7–12 (not mentor groups, Prep or Personal Study), for their teachers, Heads of Department and SMT | 0 |
| Reports and transcripts | Live | Draft→checked comments with AI help; KS3 and KS4/5 transcripts | 2 |
| Tuckshop | Live | Windowed ordering; 2-food limit; locked hand-out lists, with orders a student didn't collect marked as such and not charged; one item sold to a group, ticking off each student before anyone is charged; the bursar adds paid top-ups from recorded payments; the staff Tuckshop card shows whether ordering is open and when it next opens or closes | 3 |
| Fees | Live | Invoices, batches, discounts; two-person price approval; locked prices, by year group and by term; each fee limited to the terms it is charged in; a new fee added in one numbered form; every fee item paying into a fund, with payments shared between funds; 3rd-child discounts suggested from siblings | 2 |
| Clinic, pastoral, HR | Live | Nurse-only medical records; HR records; an Unallocated Students list of students missing a boarding house, a room or a lesson their year group has | 0 |
| Messages and email | Live | One queue; Reply-To per kind; parent pause switch; messages to the students or parents of any group of students, with parents emailed | 0 |
| Student groups | Live | Groups for activities, prefects and messages, made by SMT, pastoral and the office; lists built from six rules (negative or positive behaviour, below target, below a grade or target in one subject, a term exam average, attendance) with every setting chosen each time; mark sheets for a group, kept outside reporting; a Groups tile on the student and parent portals for groups marked to be shown (no member lists or marks) | 0 |
| Calendar and administration | Live | SMT calendar, which parents can subscribe to on their phones; editable rules on Lookups, its sections folded closed until opened; one school-wide order for students' tiles and every row of the staff dashboard, with the student, staff and behaviour-alert numbers on their module cards, and pages with a big tile kept off the cards; a Student Numbers report of boys and girls by year, mentor group, boarding room, restaurant and class; backups | 1 |
| Budgets and requisitions | Draft, principal only | Funds, term forecast from headcount and approved prices, income by fund, term budgets, contingency releases, approved suppliers, requisitions from raising to payment; practice entries only so far | 0 |
| Admissions | Part-built | Applicants, tests, interviews, letters, form fee and deposit; Next Year's Numbers from places allowed per year group, boys and girls | 2 + enrolment missing |
| Next year setup | Part-built | Academic years, mentor structure, next year's Nova-T plan | 2 + most steps missing |

## Requirements

33 requirements in three priorities: P0 fixes what is broken or risky now, P1 completes admissions and the year rollover before next September, P2 tightens the rest. Priorities are proposed; the principal decides.

### P0 — fix now

| ID | Requirement | Done when | Status |
| --- | --- | --- | --- |
| P0-1 | Gradebook import and the quick-add form on /results save again | A gradebook CSV and a quick-add result both save, with a valid result type | Not started |
| P0-2 | The school office can open /behaviour/review | Office staff release a −5 event without a picture from the page | Done |
| P0-3 | Parent visibility of a behaviour event can only change through the review | A direct request to change visibility is refused by the database | Done |
| P0-4 | The live Nova-T import refuses next year's file | Importing a planning-year file outside plan mode is blocked, with a message pointing to Next Year Setup | Not started |
| P0-5 | Assessment managers can save subject settings, or the fields they can't save are read-only | No save on /admin/subject-settings silently does nothing | Not started |
| P0-6 | An admission form fee is approved for 2026/27 and 2027/28 | The bursar records a form payment and the applicant moves to Form paid | Not started |
| P0-7 | A tuckshop top-up records a matching pre-paid payment | After a top-up the parent's invoice doesn't show as unpaid | Done |

### P1 — before September 2027

**Admissions to enrolment**

| ID | Requirement | Done when | Status |
| --- | --- | --- | --- |
| P1-1 | Enrol an accepted or deposit-paid applicant in one step | Creates an incoming student with admission number, admission date, UPN, previous school, CAT4 copied, gender, parents created or linked with their relationship to this child, and a locked login | Not started |
| P1-2 | Incoming students stay out of this year's lists, registers, charges and messages until the switch | Every student list and count filters by status; an audit of about 20 queries is done | Not started |
| P1-3 | The deposit recorded is checked against the year's deposit | A different amount needs a written reason | Not started |
| P1-4 | In-year joiners go straight to active | An applicant for the current year is enrolled as active | Not started |

**Year rollover**

| ID | Requirement | Done when | Status |
| --- | --- | --- | --- |
| P1-5 | The mentor structure lock is enforced by the database | Plan groups can't change after confirmation until reopened | Not started |
| P1-6 | Each student's progression is recorded: move up, leave, repeat | Y7–10 default to move up, Y11 undecided, Y12 leave; SMT confirm each year group | Not started |
| P1-7 | Subject choices for Y9 options and Y11→Y12 are collected in Formwork | Students or staff enter choices; a CSV goes to Nova-T | Not started |
| P1-8 | Students are placed into next year's planned classes | Block allocation and the class import work in plan mode | Not started |
| P1-9 | This year's classes map to next year's where they carry on | A mapping page links promotable blocks and classes | Not started |
| P1-10 | A readiness check lists what is missing before the switch | Shows unplaced students, classes without teachers, missing mentors | Not started |
| P1-11 | The year switch runs automatically the evening before Term 1 | At 18:00 Lagos the new year becomes current, leavers leave, incoming become active, the timetable is replaced, and this year is archived; SMT get reminders 21, 14, 7, 3 and 1 days before | Not started |

**Everyday fixes**

| ID | Requirement | Done when | Status |
| --- | --- | --- | --- |
| P1-12 | Registers Not Done, alerts and planned absences skip school holidays inside a term | No alerts on a holiday in the calendar | Not started |
| P1-13 | The weekly behaviour alert is sent once per student per week | A second negative event in the same week sends no repeat email | Not started |
| P1-14 | First passwords are always changed, enforced by the database | Every new login is flagged, and a flagged login can't read data until changed | Not started |
| P1-15 | A passed leaving date makes the student a leaver without anyone saving the record | A daily job applies it and locks the login | Not started |
| P1-16 | Decimal scores always get a grade | 89.5 takes the lower band, as transcripts already do | Not started |
| P1-17 | A parent sees every current child, even when the family has two parent records with the same email | No parent login is missing a child linked to another record with its email, and a new case is caught or prevented | Done |
| P1-18 | A mark appeal doesn't wait indefinitely when the student's teacher is away or has left | An appeal undecided after a set number of school days is passed to the Head of Department, or someone named can decide it | Not started |

### P2 — tighten later

| ID | Requirement | Done when | Status |
| --- | --- | --- | --- |
| P2-1 | Other Half: retired activities leave timetables; activities with past registers can't be deleted; year or capacity changes flag affected choices; printed timetables show OH | All four behave as described | Not started |
| P2-2 | Someone holds the other\_half coordinator role | Role assigned on /staff/roles | Not started |
| P2-3 | HR can't give themselves SMT, bursar or approver roles | Those grants need an admin | Not started |
| P2-4 | Report checkers are limited to their scope; the unused Publish switch is removed | A checker sees only their year or department | Not started |
| P2-5 | Certificate totals count every event | Totals match a direct count for students with many events | Not started |
| P2-6 | tuckshop\_owner can do what its pages offer, or the pages are hidden | Page access and data rules agree | Not started |
| P2-7 | Old applicants' personal data is removed after a retention period; interests reach the OH coordinator | A retention rule is agreed and applied | Not started |
| P2-8 | Record a Payment, All Students and Add Paid Top-Up are styled like the rest of Formwork (they use styling classes the app never loads) | The three bursar pages look like the other fee pages | Not started |

## Finance: budgets and requisitions (working draft)

The principal asked on 2 Oct 2026 for fee income to be shared out in advance across cost centres, and for staff spending to go through signed and approved requisitions. The full design is in docs/finance-budget-design.md. Phases 1 to 4 were built on 3 Oct 2026 as a working draft (migrations 338–348): only the principal sees it, and everything entered so far is practice, to be cleared in one recorded step before go-live. It is a budget and spending-control system, not accounting software: no general ledger, bank reconciliation or statutory accounts.

- **Budget:** fee income is shared out in advance across cost centres (Staffing, Power, Food, Maintenance and so on). Each cost centre shows allocated, committed, spent and remaining.
- **Requisitions:** any member of staff raises one; the principal signs it; the college secretary costs and approves it, which commits the money; the goods are received; the bursar pays.

**Decided (the principal, 2 Oct 2026)**

- Tuition goes into a general fund, shared out in advance. Direct charges (swimming, sports, exam entry, ICT, medical) are ring-fenced: what is collected for a purpose is spent on it.
- A part-payment is shared across the invoice's funds pro rata, in proportion to what each is still owed.
- Each fund's unspent balance is carried forward to the next year.
- No refund process. A rare exception goes through as a requisition against that fund.
- Uniform is out of scope (bought from the tuck shop). Tuck shop money is the students' own and stays outside the budget.

**Where it starts from:** only tuck shop has been invoiced so far; 12 funds exist and every fee item pays into one; no year-group or term prices have been approved yet, and there is no exam-entry fee item yet; no real budget, supplier or requisition has been entered (4 Oct 2026). Budgets and budget changes reuse the two-person approval already used for fee prices (the principal and the college secretary).

| ID | Phase | Done when | Status |
| --- | --- | --- | --- |
| F-1 | Cost centres and income | Every fee item points at a cost centre; each payment is split pro rata across its invoice's funds when recorded (existing payments backfilled); a budget page shows charged and collected by fund | In progress |
| F-2 | Budgets | Allocations per cost centre (optionally by term) and every change to them need the principal and the college secretary; moving money between centres goes the same way; remaining balances show | In progress |
| F-3 | Requisitions to approval | Staff raise requisitions; the principal signs; the college secretary costs and approves, committing the money, refused if it would overspend; nobody approves their own; each step emails the next person | In progress |
| F-4 | Supply and payment | Goods received item by item; the bursar pays, never more than the approved total; quotes, invoices and delivery notes attached; payroll and utility bills recorded directly on centres marked for it | In progress |
| F-5 | Year end and exams | Balances carried forward at the year switch; an exam-entry fee item and a check of charged against entered; reports for the auditors | Not started |

**Still to decide** (the design's proposed answer, which will be built unless the principal says otherwise)

- [x] Over budget: decided (the principal, 4 Oct 2026, as built). Approval beyond a cost centre's remaining budget is refused; the requisition waits until the principal releases money from Contingency, with a reason, recorded on its timeline.
- [ ] Department budgets (e.g. Science within teaching materials): not at first; cost centres can be split later.
- [ ] Petty cash for small purchases: none at first; everything goes through the full chain.
- [ ] Who records payment: the bursar.
- [ ] Allocations as fixed amounts or percentages of collections: fixed amounts, shown as percentages of expected income.
- [x] Spending against charged or collected: decided (the principal, 4 Oct 2026, as built). Invoiced, spend to cash: a real requisition can't be approved beyond the cash collected for the term.
- [ ] Damages & Surcharge: Maintenance.
- [ ] Discounts: reduce tuition (the general fund) only.
- [ ] Sports: one Sports fund for Sports Academy and Taekwondo, Swimming separate.
- [ ] Who receives goods: the requester, or a receiver the college secretary names.
- [ ] Where it sits in the roadmap: after the year rollover, or alongside it.

## Roadmap

Four phases in order, with two gates: nothing in admissions or rollover starts until the P0 fixes are done, and the switch runs only when the readiness check is clear. No dates are set yet except the switch, which follows the Term 1 2027/28 start date.

&#91;embedded content: Roadmap · 4 phases, 2 gates\]

Enrolment (phase 2) must be finished before the switch, because the switch turns incoming students into active ones.

## Success measures

This phase has worked when September 2027 opens on the right classes with nobody re-keying data, and no known issue is left undecided.

| Phase | Measure | Target |
| --- | --- | --- |
| Fix | Known issues fixed or marked "keep" | 35 of 35 |
| Fix | Rules shown on a page that the database doesn't enforce, for a change to data | 0 |
| Admissions | Accepted applicants enrolled without retyping their details | 100% |
| Admissions | Letters sent from Formwork rather than written by hand | All seven kinds |
| Rollover | Students in the right forms and classes on the first day of Term 1 | 100%, with no manual moves after the switch |
| Rollover | Hours of staff time spent on the switch | Under 2, mostly checking |
| Every day | Registers taken within 15 minutes of the start | Tracked weekly from register alerts; rising |
| Every day | Parent logins used at least once per term | Tracked per term; rising |

## Risks, dependencies and open questions

The biggest risk is the year switch: it changes every class and form at once, so it needs a readiness check, a rehearsal and a way back.

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Year switch runs on incomplete plans | Students start Term 1 in the wrong classes | Readiness check (P1-10) must be clear; SMT can delay the switch; this year is archived first |
| Next year's Nova-T file imported on the live page | This year's timetable is overwritten | P0-4 blocks it; nightly backup allows recovery |
| Incoming students leak into this year's lists | Wrong registers, charges or messages | P1-2 audit before any enrolment |
| A permission change removes someone's normal action | Staff blocked mid-task (as with invoices, 27 Sept, for 40 minutes) | Test each affected role's everyday action, not just the blocked one |
| One developer, working from a phone | Slow fixes; knowledge in one head | Functional spec, system rules and database schema kept in step with every change |

**Dependencies**

- Nova-T exports for next year's timetable, and the subject codes that match them.
- Term 1 2027/28 start date in the calendar, which sets the switch time.
- The principal's letter wording for the seven admission letters.
- The principal and the college secretary to approve fee prices.

**Open questions**

- [ ] How many Y9 option choices does each student make?
- [ ] What is the admission form fee?
- [ ] Are extra application fields needed: school reports, medical or SEN notes, a fee sponsor?
- [ ] How long are unsuccessful and withdrawn applicants kept?
- [ ] Who will hold the other\_half coordinator role?
- [ ] Should parents ever act in the portal (appeals, forms), or stay read-only?
- [ ] Should Formwork ever hold safeguarding concerns, or stay outside them? Today it has no concern record, and the User Manual tells staff to report concerns through the school's own procedure.
