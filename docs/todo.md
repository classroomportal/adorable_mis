# Adorable MIS — Outstanding Jobs

A running checklist of known work, kept in the repo so it travels with the project
rather than living in a chat session. Tick items by changing `[ ]` to `[x]` and
committing. Add new jobs under whichever section fits, or start a new section if
none fit — no special format required beyond a markdown checkbox.

## Data cleanup

- [ ] Merge duplicate/abbreviated subjects (`Dl`, `Fa`, `Gl`, `Gs`, old `Religion`) via `merge_subjects()`
- [ ] Tag key stages for `Sociology`, `Care (Vocational)`, `Electronics`, `Food/Textiles`
- [ ] Confirm the null-grade backfill from the Business merge actually ran
- [ ] Review seeded WAEC/IGCSE grade boundary guesses against real school policy

## Not yet built

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
