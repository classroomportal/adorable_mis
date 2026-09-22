-- Migration 131: let staff_roles.role_name reference the roles table, instead
-- of a hand-maintained CHECK list that has to be remembered separately.
--
-- The bug: migration 128 added the `nurse` role to `roles`, granted it
-- resources, and wrote RLS policies around it — but `staff_roles` carries its
-- own CHECK constraint listing the fourteen role names it will accept, and
-- nurse was not among them. So /staff/roles offered "Nurse / Sick Bay" in its
-- dropdown (the labels are app-side), the insert failed the constraint, and
-- the role could not actually be assigned to anybody. The Clinic was
-- unreachable for the one role it was built for.
--
-- Note for whoever hits something like this next: `sql/CURRENT_SCHEMA.md`
-- documents columns, foreign keys, triggers and RLS policies but NOT check
-- constraints, which is exactly why this was missed while writing 128 against
-- that file. Worth adding to sql/generate_current_schema.sql.
--
-- The fix is not to add 'nurse' to the list. The list is the problem: it
-- duplicates `roles`, which already exists, already has role_name as its
-- primary key, and is already where a new role gets described. Two places to
-- register a role means one of them gets forgotten — it just did.
--
-- Every role_name currently in staff_roles is already present in roles (14
-- distinct values, all matched), so the foreign key validates against today's
-- data without touching a row.

alter table staff_roles drop constraint if exists staff_roles_role_name_check;

alter table staff_roles
  add constraint staff_roles_role_name_fkey
  foreign key (role_name) references roles(role_name)
  on update cascade;

-- Adding a role is now one step — insert it into `roles` — and a role that is
-- still assigned to somebody cannot be deleted out from under them.
