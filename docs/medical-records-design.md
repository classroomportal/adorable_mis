# Student medical records — design

Status: first pass, September 2026. Schema in `migrations/128_student_medical_records.sql`,
UI in `app/components/MedicalRecordCard.js` (rendered on `/students/[id]`).

## Why this shape

The MIS held one medical field: `students.medical_notes`, free text. It was
empty for all 274 active students, so nothing was being recorded and there
was nothing to migrate.

The fact that drove every decision below: **272 of 274 active students
board.** That makes this a residential setting. The school is responsible for
day-to-day health, not just for holding an emergency contact, and it has to
be able to answer questions a text field cannot — who came to the sick bay
this week, what was given and at what dose, was the parent told, is this
child's inhaler in date, has this child stopped growing. Those are rows.

Students are 9–18 (DOB range 2008-08-01 to 2016-12-31), which matters for
how BMI is read; see below.

## The five tables

| Table | Holds |
|---|---|
| `student_medical` | 1:1 standing profile — blood group, genotype, doctor, hospital, insurance, consents |
| `student_medical_conditions` | allergies, chronic conditions, regular medication, dietary needs |
| `student_growth_measurements` | height / weight / BMI over time |
| `student_clinic_visits` | the sick bay day book |
| `student_immunisations` | vaccination record with next-due dates |

Three choices worth calling out:

**Genotype sits next to blood group.** Sickle cell trait and disease are
common enough in Nigeria that a boarding school needs AA/AS/SS on the record
— it changes how a crisis is handled, and it is not something to discover at
2am.

**Consents are booleans, not prose.** First aid, simple analgesia without
ringing home first, and emergency treatment when parents cannot be reached
are the questions the sick bay actually has to answer under pressure. All
three default to `false` — nothing is assumed on a child's behalf.

**Conditions are resolved, not deleted.** `active = false` keeps the history;
a past condition is still worth knowing about.

## BMI, and what we deliberately did not do

BMI itself is a **stored generated column** in Postgres:

```sql
bmi numeric(5,2) generated always as (
  round(weight_kg / power(height_cm / 100.0, 2), 2)
) stored
```

Derived data belongs in the database, so the app, an export and any future
report all get the same number from the same formula. The Add form shows a
live BMI preview as you type, clearly labelled as a preview — the stored
value is the one the database computes on save.

The harder question is what a BMI *means* for a 12-year-old. The adult bands
(18.5 / 25 / 30) are wrong for every student here. The correct reading is
BMI-for-age as a z-score against a growth reference (WHO 5–19), which needs
that reference's LMS parameters per sex and age in months.

**That reference data is not invented in this migration.** `bmi_for_age_reference`
ships empty and `bmi_for_age_z()` returns NULL until it is loaded from the
published WHO tables. The card then shows the BMI number with "no reference
loaded" rather than a made-up category. Making up health classifications for
children would be worse than showing none.

Once loaded, the bands are WHO's own, expressed in z: severe thinness
< −3, thinness < −2, healthy −2 to +1, overweight > +1, obesity > +2.

`student_growth_record` is the view that joins each measurement to the
child's age in months and calls the z-score function. It is
`security_invoker = true` — the three views caught in the last security sweep
were exactly this mistake, and a medical view is the last place to repeat it.

Note: `students.gender` is messy live data — 'Male', 'M', 'F' and NULL all
appear. The view normalises what it can and yields no z-score for the rest.

## Access

A new **`nurse`** role owns all of it (`is_medical_staff()`, which every
policy goes through, so widening later is one function change rather than a
sweep). `user_has_staff_role()` already lets admins through.

Deliberately **not** granted in this first pass:

- teachers, pastoral, houseparents — no clinical detail
- parents and students — nothing at all
- SMT — nothing beyond the admin bypass

The default for medical data is closed. Widening it is a separate decision
with its own migration, not something to fall into.

`students.medical_notes` is left alone; it can be retired once the structured
record is in use.

## Deliberate follow-ups

1. **Load the WHO 5–19 BMI-for-age LMS table** into `bmi_for_age_reference`.
   Until then the growth record shows BMI without a category.
2. **A staff-safe alert view** — severe allergy / epilepsy / asthma as a flag
   with no clinical detail, for trips, PE and cover teachers. Needs its own
   access decision.
3. **Houseparent read access**, scoped by the existing `my_house_scope()`,
   so the adult on duty overnight can see what a boarder is allergic to.
4. **A `/medical` sick bay dashboard** — today's visits, students currently
   resting, follow-ups outstanding, immunisations due this month. The card
   is per-student; the nurse also needs a whole-school view.
5. **Parent portal** — read-only first, then parent-submitted updates that
   staff approve. Ruled out for v1 on purpose while the RLS settles.
6. **Growth charts.** A BMI/height trend line per student, and a
   BMI-for-age centile curve once (1) is done.
7. **An access/change audit trail.** Every table carries `recorded_by` /
   `created_by` and timestamps, but there is no log of *reads*, which for
   medical records is arguably the one that matters. Note that
   `behaviour_event_audit` is existing scaffolding that was never finished —
   worth doing once, properly, for both.
8. **Bulk entry.** Height and weight get taken for a whole year group in one
   session; typing them one student at a time will not survive contact with
   the nurse.
