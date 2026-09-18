-- Migration 096: tighten fee_items/fee_terms RLS to actual stakeholders
--
-- Both tables had a blanket USING (true) SELECT policy — any logged-in user
-- (any teacher, any student) could read the full fee item price list and
-- the term list. Neither is truly public data. House rule: only parents,
-- bursar and SMT should ever see financial data.
--
-- Scoped to who actually needs it:
-- - bursar/smt manage these tables directly.
-- - tuckshop needs fee_terms only — app/tuckshop/topup/page.js tags a
--   top-up with the current fee term.
-- - parents need both — app/parent-portal/page.js reads fee_terms to find
--   the current term, and embeds fee_items(name, display_name) on each
--   invoice_line_items row for its label.
-- Using my_parent_ids() (already used elsewhere for parent-scoped RLS)
-- rather than a new is_parent() helper, since it already resolves "is this
-- caller a parent" and returns an empty set — never an error — for anyone
-- who isn't.

drop policy if exists "Authenticated users can read fee items" on fee_items;
drop policy if exists "Fee items readable by all authenticated" on fee_items;

create policy "Fee staff and parents can read fee items" on fee_items
  for select using (
    user_has_staff_role(array['bursar', 'smt'])
    or exists (select 1 from my_parent_ids())
  );

drop policy if exists "Authenticated users can read fee terms" on fee_terms;

create policy "Fee staff, tuckshop and parents can read fee terms" on fee_terms
  for select using (
    user_has_staff_role(array['bursar', 'smt', 'tuckshop'])
    or exists (select 1 from my_parent_ids())
  );
