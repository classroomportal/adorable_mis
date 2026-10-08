-- Migration 409: replies to the daily Facilities list go to Osione ILOEJE.
--
-- Why (the principal, 8 Oct 2026): "Reply goes to OC" (confirmed as Osione
-- ILOEJE, guardian.counselling@, staff code OCI). Migration 408 seeded the
-- reply route with principal@. Osione holds the guidance role, so when the
-- admin manager replies that something is fixed, they can close the worry
-- in the Worry Box. Applied through the connector on 8 Oct 2026, after the
-- first list (sent at 4 pm that day with replies to principal@).

set local formwork.change_note = 'Principal (direct)';

update public.email_reply_routes
set addresses = array['guardian.counselling@abc.sch.ng'],
    description = 'The 4 pm email to the admin manager listing Facilities worries that are not closed. It carries what the worry says, never the student. Replies go to Osione ILOEJE (guidance), who can close the worries.'
where email_kind = 'worry_box_facilities';
