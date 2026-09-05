# Adorable MIS — Outstanding Jobs

A running checklist of known work, kept in the repo so it travels with the project
rather than living in a chat session. Tick items by changing `[ ]` to `[x]` and
committing. Add new jobs under whichever section fits, or start a new section if
none fit — no special format required beyond a markdown checkbox.

## Dashboard access & design

- [ ] Build a real permissions model (role -> resource/tile grants, e.g. new role_permissions table), replacing the current handful of hardcoded isAdmin/isPastoralOrSmt checks
- [ ] Build a UI to create staff/parent/student logins directly (currently done via SQL functions in the Supabase SQL editor + manual welcome-email CSV paste)
- [ ] Role list to design permissions against: SMT, HR (manages staff details), Pastoral (manages appeals & detention), Houseparent (a separate role, but one person could also hold Teacher or Pastoral at the same time — manages room assignment, restaurant assignment 1-4; tuck shop purchases not included yet), Assessment manager, Assessment user (imports results & targets), Teacher, Student, Parent, Bursar, School office (edits student & parent core data, manages parent-student links), Admissions (new — needs its own section/workflow, not yet scoped)
- [ ] Scope out Admissions as a distinct section: handles pre-enrolment (applications, entrance test scores, offer status) as a separate flow from the live students table, before a student record is created. Not yet decided whether applicants get their own login type or this stays staff-facing only.
- [ ] Consider a more colourful/visual dashboard layout (reference: CTS Portal screenshot)
- [ ] Rename/reorganise tiles once access model is settled

## Data cleanup

- [ ] Merge duplicate/abbreviated subjects (`Dl`, `Fa`, `Gl`, `Gs`, old `Religion`) via `merge_subjects()`
- [ ] Tag key stages for `Sociology`, `Care (Vocational)`, `Electronics`, `Food/Textiles`
- [ ] Confirm the null-grade backfill from the Business merge actually ran
- [ ] Review seeded WAEC/IGCSE grade boundary guesses against real school policy

## Not yet built

- [ ] School fees / billing module (see CTS Portal reference screenshot for a possible access-control/UI pattern)
- [ ] Families management UI
- [ ] Term-based filtering wired into results and attendance views generally
- [ ] Pastoral dashboard with full-day attendance patterns
- [ ] Decide how `late` attendance status should be handled in reporting
- [ ] Compound block UI: auto-assign sibling classes
- [ ] Link the three remaining staff with missing staff codes

## Technical risk (not yet audited)

- [ ] Audit Results reporting and Timetable views for the 1000-row Supabase pagination cap
- [ ] Confirm RLS lets staff view other staff members' timetables correctly

## Longer-term / infrastructure

- [ ] Consider Vercel Pro plan for institutional compliance
- [ ] Clean up leftover MIS tables in the revision portal's separate Supabase project
- [ ] Dashboard front-page reorganisation
