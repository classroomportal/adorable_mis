# adorable_mis

Database schema for a secondary school MIS (~250 students).

## Contents
- `sql/schema.sql` — core schema: students, parents, timetable (subjects/staff/classes/slots),
  behaviour events, and weekly subject results.

## Entities
- **students** — core student record
- **parents** + **student_parent** — many-to-many link (siblings, multiple guardians)
- **subjects / staff / classes / timetable_slots / student_class** — timetable structure
- **behaviour_events** — logged incidents, positive or negative
- **results** — one row per student/subject/week

## Front End
A Next.js app lives in `/app` and `/lib`, connecting to Supabase for students, weekly results, and behaviour events.
Deploy via Vercel with env vars NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
