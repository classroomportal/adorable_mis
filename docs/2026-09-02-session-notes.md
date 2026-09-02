# Adorable MIS — Session Notes, 2 September 2026

Summary of everything built/fixed today, for reference next session.

## Data imported

| Source file | What it populated |
|---|---|
| `TBTRA–F.DAT`, `NOVACURR.TXT` (Nova-T timetable export) | 331 real teaching groups, 50 staff, 899 timetable slots, 50 curriculum blocks |
| `allstudentsatstart.csv` | Core data for all 261 students (name, DOB, year, form, boarding, UPN, etc.) |
| `timetablestudents.csv` / `timetablestudents_1.csv` | Student ↔ teaching group links (2,297 links, corrected version) |
| `parents.csv` | 1,515 parent/guardian records, linked to students by UPN |
| `staff.csv` | Real staff names (replacing placeholder "Staff XXX" codes) |
| `CoreSats.ods` | FSM/EAL/SEND/ethnicity flags, 243 CAT4 results, 62 NGRT results |

## Schema migrations (013–026)

- **013** — Teaching groups, staff, timetable_slots from Nova-T export
- **014** — Student core data + timetable links
- **015** — **Fixed a real bug**: timetable slot day/period decode was period-major; corrected to day-major (`slot = (day-1)*9 + period`). Verified against a live SIMS screenshot.
- **016** — Re-linked students to classes using the corrected `timetablestudents_1.csv` (fixed `11wi/...` typos from the first export)
- **017** — Curriculum blocks: lets staff allocate a student to one class per block (Maths sets, Options, MFL, etc.), with a DB-level one-class-per-block constraint
- **018** — Fixed missing RLS policies on `curriculum_blocks` (was silently returning zero rows to everyone)
- **019/020** — Fixed block-linking logic: prefix matching was too broad for Mentor Teaching Group codes (swept in a whole form's subject list), and Pathway/Vocational needed to be "compound" blocks (one choice = several bundled classes, e.g. Pathway "111" = Biology + Chemistry + Physics together) — verified against every student in the school, zero conflicts
- **021** — Removed 5 leftover placeholder test students and orphaned test classes from early schema development
- **022** — Real staff names from `staff.csv`
- **023** — Parents import + student links
- **024** — CAT4/NGRT + FSM/EAL/SEND data
- **025** — Behaviour category lookup table (positive/negative categories with default point values)
- **026** — Attendance code lookup table (`/`, `L`, `N`, `O`, `I`, `M`, `C`, `E`, `H` — standard register codes mapped to the existing present/late/absent/authorised categories)

## App changes

- **Curriculum Blocks** section on the student page — admins pick a class per block from a dropdown filtered to the student's year group
- **Behaviour Events** — category is now a dropdown (filtered by Positive/Negative) that auto-fills a default point value
- **Attendance** — rebuilt as a proper register: pick date + period (Registration, Period 5, etc.) + class/group (Mentor groups listed first, then subject classes), see the real roster, mark with a code dropdown, "Mark all present" shortcut, pre-fills existing marks if revisiting

## Known follow-ups for next session

- **Curriculum Blocks UI for compound blocks** (Pathway/Vocational): picking one class doesn't yet auto-assign its sibling classes in the same bundle — works correctly at the data level, just not fully smoothed over in the UI yet.
- **Updated SIMS export** expected next session — re-run the student/timetable importers with fresh data once available.
- Three staff members in `staff.csv` have no staff code (Ms C EKETE, Mr O IGBO, Miss U OKPARA) — not linked to any timetabled class currently; fine unless they pick up teaching duties.
