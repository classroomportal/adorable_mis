-- Parent/guardian contacts were imported for 10 students who had no linked
-- parent at all (mostly the 21 new joiners, plus a couple of older students
-- who'd never had a contact captured), sourced from an iSAMS parent-contact
-- export. 8 of the 9 unique guardians already existed in `parents` (matched
-- by email, or by phone where email was absent) because they already had
-- another child at the school -- those were reused via a new `student_parent`
-- row rather than duplicated. Exactly one new `parents` row was created
-- (a mother, matched to two siblings) where no existing record matched.
--
-- Applied directly against the live DB rather than replayed from this file:
-- the join keys are real parents' names, personal phone numbers, and
-- personal email addresses, and committing those literal values into git
-- history (as opposed to the database, which has its own access controls)
-- isn't appropriate. This entry exists purely so the change is documented
-- in the migration history per this repo's convention; it is intentionally
-- a no-op.

SELECT 1;
