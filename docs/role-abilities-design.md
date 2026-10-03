# Tickable role abilities: design

Status, 3 October 2026: **stages 1, 2 and 3 built** (migration 329: Certificates, Sick bay, the BMI reference and grade boundaries; migration 330: Behaviour, Attendance, Reports, plus migration 319's safeguards, which had not reached the live database; migration 331: Results and Homework); later stages not built. Today `/admin/permissions`
shows what each role can view, add, edit and delete (migration 327), read
from the database's rules, but only page access and student Core Data fields
can be changed there. This design makes the rest tickable.

What was asked for (the principal, 2 Oct 2026): "In an ideal world we should
be able to tick and untick abilities."

## Where things stand

Of the 327 database rules on 2 Oct 2026:

| Kind of rule | Count | Tickable? |
| --- | --- | --- |
| Asks only which role (or page) the person holds | 263 | Yes |
| "Own only": depends on which records are the person's (their classes, events they logged) | 36 | The fixed part stays; a role can be ticked up to "any record" |
| Parents and students only | 28 | No: not staff roles |

## Decided (the principal, 2 Oct 2026)

**These stay outside the ticks.** They are shown on the page with a padlock,
can't be ticked or unticked by anyone, admin included, and change only through
a migration agreed with the principal:

1. **Only the school office adds students** (migration 275, 328). Add on
   `students` is locked to the school_office role; admin alone is not enough.
2. **Fee prices need the principal and the college secretary** (migration
   259). Fee prices, year-group prices and the admission form fee and deposit
   change only through a proposal both have approved; nothing about them is
   tickable.
3. **Grade History and Change History can't be edited.** Add, edit and
   delete on `grade_history` and `change_history` are locked off for every
   role; who can view them stays fixed too (SMT, assessment managers and
   admins for Grade History; SMT and admins for Change History, never the
   bursar).
4. **Parents never see homework marks or the names of other students
   involved in behaviour events** (migrations 278, 303–305). Parent and
   student access is never tickable, and the triggers that refuse such names
   and hold negative events for review stay as they are.

**The safeguards** (proposed and agreed):

- **Preview before saving.** Ticking or unticking shows which members of staff
  gain or lose the ability, by name, and asks for confirmation.
- **Admin can't lock itself out.** Admin's ability to open and use
  `/admin/permissions` can't be removed.
- **Logged.** Every tick and untick is kept permanently in Change History
  under "access", with who did it.
- **The database enforces the ticks.** The page is never the check.

## How it works

- `role_abilities` (role_name, table_name, action: view / add / edit /
  delete, scope: any / own): one row per tick. Readable by staff; written only
  through `set_role_ability()`, which checks the caller is admin, refuses a
  locked cell and refuses admin locking itself out. Logged with
  `log_change('access', …)`.
- `role_ability_locks` (table_name, action, reason): the padlocked cells
  above. No write grant to any app role; changed only by migration.
- `has_ability(table, action)`: true if any role the caller holds (admin
  counting as the admin role) is ticked. Rules that today name roles are
  rewritten to call it; "own only" parts stay as fixed clauses alongside it.
- **Day one changes nothing.** The ticks are first filled with exactly what
  each role can do now (taken from the same reading that drives "What they
  can do"), and the grid must read the same before and after each stage.

## Stages

Each stage is one area, tested for every role's everyday work (not just the
attack) before the next, because a mistake either locks staff out or opens
data up (migration 214 stopped bursar payments for 40 minutes).

1. The tables, `set_role_ability()`, `has_ability()`, the padlocks and the
   preview; the "What they can do" grid becomes tick boxes for converted
   areas. Pilot areas: Certificates and Sick bay.
2. Behaviour, Attendance, Reports.
3. Results and Homework (keeping the "own only" rules and grade logging).
4. Students and families, Staff & HR, Tuckshop, The Other Half, Groups,
   Admissions.
5. Fees (prices stay locked; payments, invoices and discounts become tickable).

## Decided (the principal, 3 Oct 2026)

- Grade boundaries, subject aliases, subject key stages and registers become
  **ordinary ticks**, not padlocked.
- **Only assessment managers edit grade boundaries.** Done in stage 1
  (migration 329): until then any member of staff could. Viewing stays open
  to everyone signed in, because students and parents see grades worked out
  from them (that view is padlocked).
- Subject aliases, key stages and registers keep today's access (all staff)
  until their stage converts them.
