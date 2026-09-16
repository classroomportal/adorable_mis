-- Migration 078: the one fake staff persona, Amara Fashola
-- Everything the staff_demo login "teaches" (classes, results, behaviour, etc.)
-- is fully disposable and gets wiped + reseeded nightly by reset_demo_data() (079).
-- Her own staff row is deliberately NOT part of that wipe: profiles.staff_id and
-- staff_roles.staff_id permanently reference it once the login is provisioned
-- (see hand-off notes), so deleting/recreating it nightly would orphan the login.
--
-- Fixed id (900001, not sequence-assigned) so it's stable across every reset and
-- guaranteed out of range of any real staff_id for the foreseeable lifetime of
-- the school's real staff count.

insert into staff (staff_id, first_name, last_name, staff_code, email, is_demo)
values (900001, 'Amara', 'Fashola', 'DEMO', 'staff_demo@abc.sch.ng', true)
on conflict (staff_id) do nothing;

insert into staff_roles (staff_id, role_name)
values (900001, 'smt')
on conflict (staff_id, role_name) do nothing;
