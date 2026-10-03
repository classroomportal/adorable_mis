-- Migration 349: the 2nd Term fee term, linked to the January Term 2027.
--
-- Why: the principal, 3 Oct 2026: "set up the 2nd Term fee term". The
-- budget starts with the January Term 2027 and the bursar will start
-- looking at its invoice elements this week. Charges find their school term
-- (and so their term prices, migration 343, and the terms a fee is charged
-- in, migration 348) through fee_terms.term_id, so the new fee term is
-- linked to terms.term_id for the January Term from the start.
--
-- It is not made current (the 1st Term stays current until January; the
-- bursar picks the term when charging) and it is not published to parents:
-- parents see a term's fees only once SMT publish it.

set local formwork.change_note = 'Principal (direct)';

insert into public.fee_terms (name, academic_year, start_date, is_current, published_to_parents, term_id)
select '2nd Term', '2026/27', t.start_date, false, false, t.term_id
from public.terms t
where t.term_name = 'January Term 2027'
  and not exists (select 1 from public.fee_terms ft where ft.term_id = t.term_id);
