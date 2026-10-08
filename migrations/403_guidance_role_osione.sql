-- Migration 403: Osione ILOEJE (guardian.counselling@) holds the guidance role.
--
-- Why (the principal, 8 Oct 2026): "Merge and give Osione the role", after
-- migration 402 created `guidance` so the school's guidance staff can read and
-- work the Worry Box with the DSL and the principal. The role isn't on the
-- Staff Roles page, so who holds it is set here, with the principal's
-- agreement. Osione keeps their other roles (attendance officer, pastoral,
-- school office); none of those reach the Worry Box on their own.

set local formwork.change_note = 'Principal (direct)';

insert into public.staff_roles (staff_id, role_name)
select st.staff_id, 'guidance' from public.staff st
 where lower(btrim(st.email)) = 'guardian.counselling@abc.sch.ng'
on conflict do nothing;
