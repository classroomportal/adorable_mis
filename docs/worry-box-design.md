# Worry Box, wellbeing check-in and school rating

The school has a paper worry box where students write about things that worry them: bullying, problems with staff, broken equipment. The principal asked (7 Oct 2026) whether it could move into Formwork, and whether a mental-health question and a school rating could be added.

## The principal's decisions (7 Oct 2026)

- **Who sees a worry:** the DSL and the principal only, with the student's name, "to start with". Not admins, SMT, pastoral, houseparents or teachers.
- **Concerns about staff:** the routing first proposed (concerns about staff going to the principal and the DSL only, other kinds to pastoral or the office) is "not our method". For now every worry goes only to the DSL and the principal, so nothing else is routed. Ask the principal how the school handles concerns about staff before routing any worry to anyone else.
- **Wellbeing check-in:** once a half term.
- **Parents:** see none of it (worries, check-ins or ratings).
- **Order:** Worry Box first, then the check-in, then the rating.

## Stage 1: Worry Box (built, migration 391)

- A **Worry Box** tile on the student portal and home page. The student picks what it's about (bullying or friendships; a member of staff; how they're feeling; home or family; boarding; equipment, rooms, food or facilities; something else), writes it and can tick **urgent** ("I don't feel safe, or I need to talk to someone soon"). The page tells them to speak to any member of staff straight away if they are in danger, and says exactly who will read it (the DSL and the Principal, with their name).
- The student sees what they have sent, its status (Sent / Read by staff / Closed) and any reply. Never the staff notes.
- **The DSL and the principal** get an inbox message and an email for each new worry, saying only that one has arrived and whether it is urgent. No name, category or text leaves the worry tables: inbox messages and the email outbox are reachable by other people.
- `/worry-box` (row 2 tile on their dashboard, with counts of new and urgent): the list (new and open, new, closed, everything; by kind), each worry with its history, notes (staff only), replies (the student sees them; they get an inbox notice without the text), close and reopen.
- **Paper slips** are typed in on the same page, with or without a student's name, and the date found. The paper box stays.
- Nothing is deleted; notes can't be edited. Not in Change History (SMT and admins read it): `worry_notes` is the record.
- At most 5 worries a day per student.

## Stage 2: half-termly wellbeing check-in (not built)

Proposed: once a half term, a short check-in on the portal ("How are you feeling?" on five faces, plus one or two optional Yes/No questions such as "Is there an adult at school you could talk to?"). A low answer, or the same low answer twice running, would alert the DSL. It isn't shown to class teachers, and every screen points to a member of staff and the Worry Box. It helps the school notice who needs a conversation; it is not a diagnosis. Still to decide: the questions, who is alerted (the DSL alone, or the principal too), and whether students can skip it.

## Stage 3: school rating (not built)

Proposed: a termly student-voice survey rating areas such as lessons, safety, food, boarding, facilities and being listened to (1–5), with an optional comment. Staff see totals by year and house only, with any group under 3 answers held back (the lesson-feedback rule). Still to decide: the areas, how often, and who sees the totals.
