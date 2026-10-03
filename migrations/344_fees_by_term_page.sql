-- Migration 344: the Fees by year & term page on the Budget tile.
--
-- Why: the principal, 3 Oct 2026: "I was expecting to put the fees per year
-- and per term in." Migration 343 added approved prices by year and term;
-- /finance/term-fees is where they are seen and proposed. Granted to the
-- principal only, like the rest of the Budget while it is being built.
-- Proposing and approving are still checked by propose_fee_item_term_prices()
-- (can_propose_fee_prices()) and approve_fee_price_change() (principal and
-- college secretary), so the page grant widens nothing.

set local formwork.change_note = 'Principal (direct)';

insert into public.resources (resource_key, label, section, sort_order) values
  ('/finance/term-fees', 'Fees by year & term', 'Budget', 0)
on conflict (resource_key) do nothing;

insert into public.role_permissions (role_name, resource_key) values
  ('principal', '/finance/term-fees')
on conflict do nothing;
